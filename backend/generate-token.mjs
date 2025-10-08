import jwt from 'jsonwebtoken';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const ssm = new SSMClient({ region: 'eu-west-1' });

const response = await ssm.send(new GetParameterCommand({
  Name: '/lemonsqueezer/dev/jwt-secret',
  WithDecryption: true
}));

const secret = response.Parameter.Value;

const token = jwt.sign(
  { userId: 'test-user-123', email: 'test@example.com' },
  secret,
  { expiresIn: '1h' }
);

console.log(token);
