// tslint:disable:max-line-length
import { expect } from 'chai';
import { fromBase58 } from 'bip32';
import { address } from 'bitcoinjs-lib';
import { getHexBuffer } from '../../../lib/Utils';
import Networks from '../../../lib/consts/Networks';
import { OutputType } from '../../../lib/proto/xchangerpc_pb';
import { constructClaimTransaction } from '../../../lib/swap/Claim';

// TODO: use valid values
describe('Claim', () => {
  const preimage = getHexBuffer('b5b2dbb1f0663878ecbc20323b58b92c');
  const swapKeys = fromBase58('xprv9xgxR6htMdXUXGipynZp1janNrWNYJxaz2o4tH9fdtZqcF26BX5VB88GSM5KgZHWCyAyb8FZpQik2UET84CHfGWXFMG5zWWjmtDMgqYuo19');
  const redeemScript = getHexBuffer('a914a0738c92fde6361f09d28950c7bd0d2bf32b34be87632103be4a251dae719d565ce1d6a7a5787df99fc1ecc1f6e847567981a686f32abce167027802b1752103f7877d4ae985bb30b6f150ad6b6b9935c342432beed1a4781347b169c1e2417368ac');
  const destinationScript = address.toOutputScript('bcrt1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqdku202', Networks.bitcoinRegtest);

  const utxo = {
    txHash: getHexBuffer('285d227e2823c679c224b4d562a9b5b5b7b927badd483df9f4225c6fc761d754'),
    vout: 0,
    value: 2000,
  };

  it('should claim a P2WSH swap', () => {
    const testData = {
      args: {
        utxo: {
          ...utxo,
          type: OutputType.BECH32,
          script: getHexBuffer('00206f38b6ce82427d4df080a9833d06cc6c66ab816545c9fd4df50f9d1ca8430b9e'),
        },
      },
      result: '01000000000101285d227e2823c679c224b4d562a9b5b5b7b927badd483df9f4225c6fc761d75400000000000000000001e803000000000000160014000000000000000000000000000000000000000003483045022100d20a8e1b5c8f7cf2152ed2a8d67b74222cc358d0ba8292ce554cb5b67273426302203e0820cb199e22645a3182ca7f330040aa1b2464f0882b8575b0db7c83c3d4360110b5b2dbb1f0663878ecbc20323b58b92c64a914a0738c92fde6361f09d28950c7bd0d2bf32b34be87632103be4a251dae719d565ce1d6a7a5787df99fc1ecc1f6e847567981a686f32abce167027802b1752103f7877d4ae985bb30b6f150ad6b6b9935c342432beed1a4781347b169c1e2417368ac00000000',
    };

    const result = constructClaimTransaction(
      preimage,
      swapKeys,
      destinationScript,
      testData.args.utxo,
      redeemScript,
    );

    expect(result.toHex()).to.be.equal(testData.result);
  });

  it('should claim a P2SH swap', () => {
    const testData = {
      args: {
        utxo: {
          ...utxo,
          type: OutputType.LEGACY,
          script: getHexBuffer('a9148f439aff651860bdb28c66500c6e958cfbe7a69387'),
        },
      },
      result: '0100000001285d227e2823c679c224b4d562a9b5b5b7b927badd483df9f4225c6fc761d75400000000bf47304402200c4b0b5cf4145b141a4cd83bda468f5d8e3c8e48251a8bf639e488c911b294d4022017c8093fabbe72a7a0ea8a35beda964948c2e295bef0e36ac987f954ba7f3d970110b5b2dbb1f0663878ecbc20323b58b92c4c64a914a0738c92fde6361f09d28950c7bd0d2bf32b34be87632103be4a251dae719d565ce1d6a7a5787df99fc1ecc1f6e847567981a686f32abce167027802b1752103f7877d4ae985bb30b6f150ad6b6b9935c342432beed1a4781347b169c1e2417368ac0000000001e803000000000000160014000000000000000000000000000000000000000000000000',
    };

    const result = constructClaimTransaction(
      preimage,
      swapKeys,
      destinationScript,
      testData.args.utxo,
      redeemScript,
    );

    expect(result.toHex()).to.be.equal(testData.result);
  });

  it('should claim a P2SH nested P2WSH swap', () => {
    const testData = {
      args: {
        utxo: {
          ...utxo,
          type: OutputType.COMPATIBILITY,
          script: getHexBuffer('a9143cdeb56e328a10d3bfe107fd5a16bd73871adb8d87'),
        },
      },
      result: '01000000000101285d227e2823c679c224b4d562a9b5b5b7b927badd483df9f4225c6fc761d75400000000232200206f38b6ce82427d4df080a9833d06cc6c66ab816545c9fd4df50f9d1ca8430b9e0000000001e803000000000000160014000000000000000000000000000000000000000003483045022100d20a8e1b5c8f7cf2152ed2a8d67b74222cc358d0ba8292ce554cb5b67273426302203e0820cb199e22645a3182ca7f330040aa1b2464f0882b8575b0db7c83c3d4360110b5b2dbb1f0663878ecbc20323b58b92c64a914a0738c92fde6361f09d28950c7bd0d2bf32b34be87632103be4a251dae719d565ce1d6a7a5787df99fc1ecc1f6e847567981a686f32abce167027802b1752103f7877d4ae985bb30b6f150ad6b6b9935c342432beed1a4781347b169c1e2417368ac00000000',
    };

    const result = constructClaimTransaction(
      preimage,
      swapKeys,
      destinationScript,
      testData.args.utxo,
      redeemScript,
    );

    expect(result.toHex()).to.be.equal(testData.result);
  });
});
