import { Arguments } from 'yargs';
import { callback, loadXchangeClient } from '../Command';
import { NewAddressRequest } from '../../proto/xchangerpc_pb';
import { getOutputType } from '../Utils';
import BuilderComponents from '../BuilderComponents';

export const command = 'newaddress <currency> [type]';

export const describe = 'get a new address for the specified coin';

export const builder = {
  currency: {
    describe: 'ticker symbol of the currency',
    type: 'string',
  },
  type: BuilderComponents.outputType,
};

export const handler = (argv: Arguments) => {
  const request = new NewAddressRequest();

  request.setCurrency(argv.currency);
  request.setType(getOutputType(argv.type));

  loadXchangeClient(argv).newAddress(request, callback);
};
