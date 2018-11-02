import { BIP32 } from 'bip32';
import { Transaction, Network, address, crypto, TransactionBuilder, ECPair } from 'bitcoinjs-lib';
import ChainClient from '../chain/ChainClient';
import { OutputType } from '../proto/xchangerpc_pb';
import { getPubKeyHashEncodeFuntion, getHexString, getHexBuffer } from '../Utils';
import Errors from './Errors';
import Logger from '../Logger';
import { TransactionOutput } from '../consts/Types';
import UtxoRepository from './UtxoRepository';
import WalletRepository from './WalletRepository';

type UTXO = TransactionOutput & {
  keys: BIP32;
};

// TODO: wait for funds being confirmed
// TODO: fix coinbase transactions not being recognised
// TODO: more advanced UTXO management
// TODO: save UTXOs to disk
// TODO: multiple transaction to same output
class Wallet {
  private relevantOutputs = new Map<string, { keyIndex: number, type: OutputType }>();

  private symbol: string;

  /**
   * Wallet is a hierarchical deterministic wallet for a single currency
   *
   * @param masterNode the master node from which wallets are derived
   * @param network the network of the wallet
   * @param chainClient the ChainClient for the network
   * @param derivationPath should be in the format "m/0/<index of the wallet>"
   * @param highestIndex the highest index of a used address in the wallet
   */
  constructor(
    private logger: Logger,
    private walletRepository: WalletRepository,
    private utxoRepository: UtxoRepository,
    private masterNode: BIP32,
    public readonly network: Network,
    private chainClient: ChainClient,
    public readonly derivationPath: string,
    private highestIndex: number) {

    this.symbol = this.chainClient.symbol;

    this.chainClient.on('transaction.relevant', (txHex) => {
      const transaction = Transaction.fromHex(txHex);

      transaction.outs.forEach(async (output, vout) => {
        const hexScript = getHexString(output.script);
        const outputInfo = this.relevantOutputs.get(hexScript);

        if (outputInfo) {
          this.logger.debug(`Found UTXO of ${this.symbol} wallet: ${transaction.getId()}:${vout} with value ${output.value}`);

          this.relevantOutputs.delete(hexScript);
          await this.utxoRepository.addUtxo({
            vout,
            currency: this.symbol,
            txHash: getHexString(transaction.getHash()),
            script: getHexString(output.script),
            value: output.value,
            ...outputInfo,
          });
        }
      });
    });
  }

  public get highestUsedIndex() {
    return this.highestIndex;
  }

  /**
   * Gets a specific pair of keys
   *
   * @param index index of the keys to get
   */
  public getKeysByIndex = (index: number) => {
    return this.masterNode.derivePath(`${this.derivationPath}/${index}`);
  }

  /**
   * Gets a new pair of keys
   */
  public getNewKeys = () => {
    this.highestIndex += 1;

    // tslint:disable-next-line no-floating-promises
    this.walletRepository.updateHighestUsedIndex(this.symbol, this.highestIndex);

    return {
      keys: this.getKeysByIndex(this.highestIndex),
      index: this.highestIndex,
    };
  }

  /**
   * Gets a new address
   *
   * @param type ouput type of the address
   */
  public getNewAddress = async (type: OutputType) => {
    const { keys, index } = this.getNewKeys();

    const encodeFunction = getPubKeyHashEncodeFuntion(type);
    const output = encodeFunction(crypto.hash160(keys.publicKey));
    const address = this.encodeAddress(output);

    await this.listenToOutput(output, index, type, address);

    return address;
  }

  /**
   * Encodes an address
   *
   * @param outputScript the output script to encode
   */
  public encodeAddress = (outputScript: Buffer) => {
    return address.fromOutputScript(
      outputScript,
      this.network,
    );
  }

  /**
   * Add an output that can be spent by the wallet
   *
   * @param output a P2WPKH, P2SH nested P2WPKH or P2PKH ouput
   */
  public listenToOutput = async (output: Buffer, keyIndex: number, type: OutputType, address?: string) => {
    this.relevantOutputs.set(getHexString(output), { keyIndex, type });

    const chainAddress = address ? address : this.encodeAddress(output);
    await this.chainClient.loadTxFiler(false, [chainAddress], []);
  }

  /**
   * Get the balance of the wallet
   */
  public getBalance = async () => {
    let balance = 0;

    const utxos = await this.utxoRepository.getUtxos(this.symbol);

    utxos.forEach((utxo) => {
      balance += utxo.value;
    });

    return balance;
  }

  // TODO: fee estimation
  // TODO: compatibility for nested Segwit addresses
  /** Sends a specific amount of funds to and address
   *
   * @param address address to which funds should be sent
   * @param amount how mush should be sent
   *
   * @returns the transaction itself and the vout of the addres
   */
  public sendToAddress = async (address: string, amount: number): Promise<{ tx: Transaction, vout: number }> => {
    const utxos = await this.utxoRepository.getUtxosSorted(this.symbol);

    let missingAmount = amount + 1000;

    // The UTXOs that will be spent
    const toSpend: UTXO[] = [];
    // The hex encoded strings of the UTXOs that will be spent
    const toRemove: string[] = [];

    // Accumulate UTXO to spend
    for (const utxoInstance of utxos) {
      missingAmount -= utxoInstance.value;
      toSpend.push({
        txHash: getHexBuffer(utxoInstance.txHash),
        vout: utxoInstance.vout,
        type: utxoInstance.type,
        script: getHexBuffer(utxoInstance.script),
        value: utxoInstance.value,
        keys: this.getKeysByIndex(utxoInstance.keyIndex),
      });
      toRemove.push(utxoInstance.txHash);

      if ((missingAmount) <= 0) {
        break;
      }
    }

    // Throw an error if the wallet doesn't have enough funds
    if (missingAmount > 0) {
      throw Errors.NOT_ENOUGH_FUNDS(amount);
    }

    // Remove the UTXOs that are going to be spent from the UTXOs of the wallet
    const removePromises: Promise<any>[] = [];
    toRemove.forEach((txHash) => {
      removePromises.push(this.utxoRepository.removeUtxo(txHash));
    });

    await Promise.all(removePromises);

    // Construct the transaction
    const builder = new TransactionBuilder(this.network);

    // Add the UTXOs from before as inputs
    toSpend.forEach((utxo) => {
      if (utxo.type !== OutputType.LEGACY) {
        builder.addInput(utxo.txHash, utxo.vout, undefined, utxo.script);
      } else {
        builder.addInput(utxo.txHash, utxo.vout);
      }
    });

    // Add the requested ouput to the transaction
    builder.addOutput(address, amount);

    // If there is anything left from the value of the UTXOs send it to a new change address
    if (missingAmount !== 0) {
      builder.addOutput(await this.getNewAddress(OutputType.BECH32), missingAmount * -1);
    }

    // Sign the transaction
    toSpend.forEach((utxo, index) => {
      const keys = ECPair.fromPrivateKey(utxo.keys.privateKey, { network: this.network });

      if (utxo.type !== OutputType.LEGACY) {
        builder.sign(index, keys, undefined, undefined, utxo.value);
      } else {
        builder.sign(index, keys);
      }
    });

    return {
      tx: builder.build(),
      vout: 0,
    };
  }
}

export default Wallet;
