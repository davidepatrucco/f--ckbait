// secrets.mjs - Gestione sicura delle variabili d'ambiente sensibili

import { SSMClient, GetParameterCommand, GetParametersCommand } from '@aws-sdk/client-ssm';

// Cache dei secrets per evitare chiamate ripetute
const secretsCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minuti

// Client SSM
const ssmClient = new SSMClient({
    region: process.env.AWS_REGION || 'eu-west-1'
});

/**
 * Ottieni un secret da Parameter Store o variabile d'ambiente
 */
export async function getSecret(secretName) {
    // Se è in ambiente locale/test, usa variabili d'ambiente normali
    if (isLocalEnvironment()) {
        return process.env[secretName];
    }

    // Controlla cache
    const cacheKey = secretName;
    const cached = secretsCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
        return cached.value;
    }

    try {
        const parameterName = getParameterPath(secretName);
        
        const command = new GetParameterCommand({
            Name: parameterName,
            WithDecryption: true
        });

        const response = await ssmClient.send(command);
        const value = response.Parameter?.Value;

        // Salva in cache
        secretsCache.set(cacheKey, {
            value,
            timestamp: Date.now()
        });

        return value;

    } catch (error) {
        console.warn(`Failed to get secret ${secretName} from Parameter Store:`, error.message);
        
        // Fallback a variabile d'ambiente
        const envValue = process.env[secretName];
        if (envValue) {
            console.warn(`Using fallback environment variable for ${secretName}`);
            return envValue;
        }

        throw new Error(`Secret ${secretName} not found in Parameter Store or environment variables`);
    }
}

/**
 * Ottieni più secrets in una volta sola
 */
export async function getSecrets(secretNames) {
    if (isLocalEnvironment()) {
        const secrets = {};
        secretNames.forEach(name => {
            secrets[name] = process.env[name];
        });
        return secrets;
    }

    try {
        const parameterNames = secretNames.map(name => getParameterPath(name));
        
        const command = new GetParametersCommand({
            Names: parameterNames,
            WithDecryption: true
        });

        const response = await ssmClient.send(command);
        const secrets = {};

        response.Parameters?.forEach(param => {
            const secretName = extractSecretName(param.Name);
            secrets[secretName] = param.Value;
            
            // Cache individualmente
            secretsCache.set(secretName, {
                value: param.Value,
                timestamp: Date.now()
            });
        });

        // Per i parametri non trovati, prova fallback
        const notFound = response.InvalidParameters || [];
        for (const paramName of notFound) {
            const secretName = extractSecretName(paramName);
            const envValue = process.env[secretName];
            if (envValue) {
                console.warn(`Using fallback environment variable for ${secretName}`);
                secrets[secretName] = envValue;
            }
        }

        return secrets;

    } catch (error) {
        console.error('Error getting secrets from Parameter Store:', error);
        
        // Fallback completo a variabili d'ambiente
        const secrets = {};
        secretNames.forEach(name => {
            secrets[name] = process.env[name];
        });
        return secrets;
    }
}

/**
 * Configurazione lazy per secrets utilizzati frequentemente
 */
export class SecretsManager {
    constructor() {
        this.secrets = {};
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return;

        try {
            const secretNames = [
                'OPENAI_API_KEY',
                'JWT_SECRET',
                'STRIPE_SECRET_KEY',
                'STRIPE_WEBHOOK_SECRET',
                'STRIPE_PREMIUM_MONTHLY_PRICE_ID',
                'STRIPE_PREMIUM_YEARLY_PRICE_ID',
                'STRIPE_SUCCESS_URL',
                'STRIPE_CANCEL_URL',
                'GOOGLE_WEB_CLIENT_ID',
                'GOOGLE_WEB_CLIENT_SECRET'
            ];

            this.secrets = await getSecrets(secretNames);
            this.initialized = true;
            
            console.log('✅ Secrets loaded successfully');
        } catch (error) {
            console.error('❌ Failed to initialize secrets:', error);
            throw error;
        }
    }

    get(secretName) {
        if (!this.initialized) {
            throw new Error('SecretsManager not initialized. Call initialize() first.');
        }
        return this.secrets[secretName];
    }

    // Alias per compatibilità
    async getSecret(secretName) {
        if (!this.initialized) {
            await this.initialize();
        }
        return this.get(secretName);
    }

    // Getter convenience methods
    get openaiApiKey() { return this.get('OPENAI_API_KEY'); }
    get jwtSecret() { return this.get('JWT_SECRET'); }
    get stripeSecretKey() { return this.get('STRIPE_SECRET_KEY'); }
    get stripeWebhookSecret() { return this.get('STRIPE_WEBHOOK_SECRET'); }
}

// Istanza globale singleton
let secretsManager = null;

export function getSecretsManager() {
    if (!secretsManager) {
        secretsManager = new SecretsManager();
    }
    return secretsManager;
}

// --- Helper functions ---

function isLocalEnvironment() {
    const env = process.env.ENVIRONMENT || process.env.NODE_ENV;
    return env === 'development' || env === 'test' || !process.env.AWS_REGION || process.env.IS_LOCAL === 'true';
}

function getParameterPath(secretName) {
    const prefix = process.env.PARAMETER_STORE_PREFIX || '/reading-intelligence/dev';
    return `${prefix}/${secretName.toLowerCase().replace(/_/g, '-')}`;
}

function extractSecretName(parameterPath) {
    const parts = parameterPath.split('/');
    const lastPart = parts[parts.length - 1];
    return lastPart.toUpperCase().replace(/-/g, '_');
}

/**
 * Utility per setup iniziale Parameter Store
 */
export function getSetupInstructions() {
    const env = process.env.ENVIRONMENT || 'dev';
    
    return {
        message: "Per configurare i secrets su AWS Parameter Store:",
        commands: [
            `# Configura OpenAI API Key`,
            `aws ssm put-parameter --name "/reading-intelligence/${env}/openai-api-key" --value "sk-proj-..." --type "SecureString"`,
            ``,
            `# Configura JWT Secret`,
            `aws ssm put-parameter --name "/reading-intelligence/${env}/jwt-secret" --value "$(openssl rand -hex 32)" --type "SecureString"`,
            ``,
            `# Configura Stripe Keys`,
            `aws ssm put-parameter --name "/reading-intelligence/${env}/stripe-secret-key" --value "sk_test_..." --type "SecureString"`,
            `aws ssm put-parameter --name "/reading-intelligence/${env}/stripe-webhook-secret" --value "whsec_..." --type "SecureString"`,
            ``,
            `# Opzionali per Stripe`,
            `aws ssm put-parameter --name "/reading-intelligence/${env}/stripe-premium-monthly-price-id" --value "price_..." --type "String"`,
            `aws ssm put-parameter --name "/reading-intelligence/${env}/stripe-premium-yearly-price-id" --value "price_..." --type "String"`,
            `aws ssm put-parameter --name "/reading-intelligence/${env}/stripe-success-url" --value "https://lemonsqueezer.com/success" --type "String"`,
            `aws ssm put-parameter --name "/reading-intelligence/${env}/stripe-cancel-url" --value "https://lemonsqueezer.com/cancel" --type "String"`
        ],
        note: "I parametri SecureString sono automaticamente encrypted con AWS KMS"
    };
}