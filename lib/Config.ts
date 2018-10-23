import path from 'path';
import fs from 'fs';
import toml from 'toml';
import ini from 'ini';
import { Arguments } from 'yargs';
import { pki, md } from 'node-forge';
import { deepMerge, resolveHome, splitListen, getServiceDataDir } from './Utils';
import { RpcConfig } from './RpcClient';
import { LndConfig } from './lightning/LndClient';
import { GrpcConfig } from './grpc/GrpcServer';
import { XudConfig } from './xud/XudClient';
import Errors from './consts/Errors';
import Networks from './consts/Networks';

type ServiceOptions = {
  datadir?: string;
  configpath?: string;
};

type CurrencyConfig = {
  symbol: string,
  network: string;
  chainclient: RpcConfig & ServiceOptions;
  lndclient?: LndConfig & ServiceOptions;
};

type ConfigType = {
  datadir: string;

  configpath: string;
  logpath: string;
  loglevel: string;
  walletpath: string;

  grpc: GrpcConfig;

  xud: XudConfig & ServiceOptions;

  currencies: CurrencyConfig[];
};

class Config {
  private config: ConfigType;

  private dataDir: string;
  private xudDir: string;

  /**
   * The constructor sets the default values
   */
  constructor() {
    this.dataDir = getServiceDataDir('xchange');
    this.xudDir = getServiceDataDir('xud');

    const { configpath, walletpath, logpath } = this.getDataDirPaths(this.dataDir);

    this.config = {
      configpath,
      logpath,
      walletpath,

      datadir: this.dataDir,
      loglevel: this.getDefaultLogLevel(),

      grpc: {
        host: '127.0.0.1',
        port: 9000,
        certpath: path.join(this.dataDir, 'tls.cert'),
        keypath: path.join(this.dataDir, 'tls.key'),
      },
      xud: {
        host: '127.0.0.1',
        port: 8886,
        configpath: path.join(this.xudDir, 'xud.conf'),
        certpath: path.join(this.xudDir, 'tls.cert'),
      },

      currencies: [
        {
          symbol: 'BTC',
          network: 'bitcoinTestnet',
          chainclient: {
            host: '127.0.0.1',
            port: 18334,
            datadir: getServiceDataDir('btcd'),
            certpath: '',
            rpcpass: 'user',
            rpcuser: 'user',
          },
          lndclient: {
            host: '127.0.0.1',
            port: 10009,
            datadir: getServiceDataDir('lnd'),
            certpath: path.join(getServiceDataDir('lnd'), 'tls.cert'),
            macaroonpath: path.join(getServiceDataDir('lnd'), 'data', 'chain', 'bitcoin', 'testnet', 'admin.macaroon'),
          },
        },
        {
          symbol: 'LTC',
          network: 'litecoinTestnet',
          chainclient: {
            host: '127.0.0.1',
            port: 19334,
            datadir: getServiceDataDir('ltcd'),
            certpath: '',
            rpcpass: 'user',
            rpcuser: 'user',
          },
          lndclient: {
            host: '127.0.0.1',
            port: 11009,
            datadir: getServiceDataDir('lnd'),
            certpath: path.join(getServiceDataDir('lnd_ltc'), 'tls.cert'),
            macaroonpath: path.join(getServiceDataDir('lnd_ltc'), 'data', 'chain', 'litecoin', 'testnet', 'admin.macaroon'),
          },
        },
      ],
    };
  }

  // TODO: get path of the certificate, macaroon and config based on the data directory of the service
  // TODO: verify logLevel exists; depends on Logger.ts:8
  /**
   * This loads arguments specified by the user either with a TOML config file or via command line arguments
   */
  public load = (args: Arguments): ConfigType => {
    if (args.datadir) {
      this.config.datadir = resolveHome(args.datadir);
      deepMerge(this.config, this.getDataDirPaths(this.config.datadir));
    }

    if (!fs.existsSync(this.config.datadir)) {
      fs.mkdirSync(this.config.datadir);
    }

    const xchangeConfigFile = this.resolveConfigPath(args.configPath, this.config.configpath);

    if (fs.existsSync(xchangeConfigFile)) {
      const tomlConfig = this.parseTomlConfig(xchangeConfigFile);
      deepMerge(this.config, tomlConfig);
    }

    const grpcCert = args.grpc ? args.grpc.certpath : this.config.grpc.certpath;
    const grpcKey = args.grpc ?  args.grpc.keypath : this.config.grpc.keypath;

    if (!fs.existsSync(grpcCert) && !fs.existsSync(grpcKey)) {
      this.generateCertificate(grpcCert, grpcKey);
    }

    if (args.currencies) {

    }

    deepMerge(this.config, args);

    return this.config;
  }

  // TODO: don't use "deepMerge" in "parseIniConfig"
  private parseIniConfig = (filename: string, mergeTarget: any, isLndConfig: boolean) => {
    if (fs.existsSync(filename)) {
      try {
        const config = ini.parse(fs.readFileSync(filename, 'utf-8'))['Application Options'];

        if (isLndConfig) {
          const configLND: LndConfig = config;
          if (config.listen) {
            const listen = splitListen(config.listen);
            mergeTarget.host = listen.host;
            mergeTarget.port = listen.port;
          }
          deepMerge(mergeTarget, configLND);
        } else {
          const configClient: RpcConfig = config;
          if (config.listen) {
            const listen = splitListen(config.listen);
            mergeTarget.host = listen.host;
            mergeTarget.port = listen.port;
          }
          deepMerge(mergeTarget, configClient);
        }
      } catch (error) {
        throw Errors.COULD_NOT_PARSE_CONFIG(filename, error);
      }
    }
  }

  private parseTomlConfig = (filename: string): any => {
    if (fs.existsSync(filename)) {
      try {
        const tomlFile = fs.readFileSync(filename, 'utf-8');
        return toml.parse(tomlFile);
      } catch (error) {
        throw Errors.COULD_NOT_PARSE_CONFIG(filename, error);
      }
    }
  }

  private getDataDirPaths = (dataDir: string): { configpath: string, walletpath: string, logpath: string } => {
    return {
      configpath: path.join(dataDir, 'xchange.conf'),
      walletpath: path.join(dataDir, 'xchange.dat'),
      logpath: path.join(dataDir, 'xchange.log'),
    };
  }

  private resolveConfigPath = (configPath: string, fallback: string) => {
    return configPath ? resolveHome(configPath) : fallback;
  }

  private getDefaultLogLevel = (): string => {
    return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
  }

  private generateCertificate = (tlsCertPath: string, tlsKeyPath: string): void => {
    const keys = pki.rsa.generateKeyPair(1024);
    const cert = pki.createCertificate();

    cert.publicKey = keys.publicKey;
    cert.serialNumber = String(Math.floor(Math.random() * 1024) + 1);

    const date = new Date();
    cert.validity.notBefore = date;
    cert.validity.notAfter = new Date(date.getFullYear() + 5, date.getMonth(), date.getDay());

    const attributes = [
      {
        name: 'organizationName',
        value: 'Xchange autogenerated certificate',
      },
    ];

    cert.setSubject(attributes);
    cert.setIssuer(attributes);

    cert.setExtensions([
      {
        name: 'subjectAltName',
        altNames: [
          {
            type: 2,
            value: 'localhost',
          },
          {
            type: 7,
            ip: '127.0.0.1',
          },
        ],
      },
    ]);

    cert.sign(keys.privateKey, md.sha256.create());

    const certificate = pki.certificateToPem(cert);
    const privateKey = pki.privateKeyToPem(keys.privateKey);

    fs.writeFileSync(tlsCertPath, certificate);
    fs.writeFileSync(tlsKeyPath, privateKey);
  }
}

export default Config;
export { ConfigType };
