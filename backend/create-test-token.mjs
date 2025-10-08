import jwt from 'jsonwebtoken';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const client = new SSMClient({ region: 'eu-west-1' });
const command = new GetParameterCommand({
    Name: '/lemonsqueezer/dev/jwt-secret',
    WithDecryption: true
});

const response = await client.send(command);
const jwtSecret = response.Parameter.Value;

const token = jwt.sign(
    {
        userId: 'test-user-123',
        email: 'test@example.com',
        plan: 'premium'
    },
    jwtSecret,
    { expiresIn: '1h' }
);

console.log('JWT Token:');
console.log(token);
