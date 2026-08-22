#!/bin/bash

# deploy.sh - Script di deployment per LemonSqueezer backend

set -e  # Exit on any error

# Colori per output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Funzione per logging
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

error() {
    echo -e "${RED}[ERROR] $1${NC}"
}

success() {
    echo -e "${GREEN}[SUCCESS] $1${NC}"
}

warning() {
    echo -e "${YELLOW}[WARNING] $1${NC}"
}

# Verifica prerequisiti
check_prerequisites() {
    log "Verifica prerequisiti..."
    
    # Verifica AWS CLI
    if ! command -v aws &> /dev/null; then
        error "AWS CLI non trovato. Installa AWS CLI prima di continuare."
        exit 1
    fi
    
    # Verifica SAM CLI
    if ! command -v sam &> /dev/null; then
        error "SAM CLI non trovato. Installa SAM CLI prima di continuare."
        exit 1
    fi
    
    # Verifica Node.js
    if ! command -v node &> /dev/null; then
        error "Node.js non trovato. Installa Node.js prima di continuare."
        exit 1
    fi
    
    # Verifica configurazione AWS
    if ! aws sts get-caller-identity &> /dev/null; then
        error "AWS non configurato. Esegui 'aws configure' prima di continuare."
        exit 1
    fi
    
    success "Tutti i prerequisiti sono soddisfatti"
}

# Configurazione parametri
setup_parameters() {
    log "Configurazione parametri..."
    
    # Carica parametri dal file .env
    ENV_FILE="../.env"
    if [ -f "$ENV_FILE" ]; then
        log "Caricamento parametri da $ENV_FILE..."
        source "$ENV_FILE"
        
        # Verifica che tutti i parametri necessari siano presenti
        if [ -z "$OPENAI_API_KEY" ]; then
            error "OPENAI_API_KEY non trovata nel file .env"
            exit 1
        fi
        
        if [ -z "$ENVIRONMENT" ]; then
            warning "ENVIRONMENT non trovato nel file .env, uso 'dev' come default"
            ENVIRONMENT="dev"
        fi
        
        if [ -z "$AWS_REGION" ]; then
            warning "AWS_REGION non trovato nel file .env, uso configurazione AWS CLI"
            AWS_REGION=$(aws configure get region)
            if [ -z "$AWS_REGION" ]; then
                AWS_REGION="eu-west-1"
                warning "Uso eu-west-1 come region di default"
            fi
        fi
        
        log "Parametri caricati da .env:"
        log "  Environment: $ENVIRONMENT"
        log "  AWS Region: $AWS_REGION"
        log "  OpenAI API Key: ${OPENAI_API_KEY:0:8}..."
        
    else
        error "File .env non trovato in $ENV_FILE"
        error "Crea il file .env con i seguenti parametri:"
        error "  OPENAI_API_KEY=sk-..."
        error "  ENVIRONMENT=dev"
        error "  AWS_REGION=eu-west-1"
        exit 1
    fi
    
    # Stack name
    STACK_NAME="lemonsqueezer-${ENVIRONMENT}"
    
    # S3 bucket per SAM
    SAM_BUCKET="lemonsqueezer-sam-${ENVIRONMENT}-$(date +%s)"
    
    log "Configurazione finale:"
    log "  Environment: $ENVIRONMENT"
    log "  AWS Region: $AWS_REGION"
    log "  Stack Name: $STACK_NAME"
    log "  SAM Bucket: $SAM_BUCKET"
}

# Build del progetto
build_project() {
    log "Build del progetto..."
    
    # Vai alla root del progetto
    cd ../../
    
    # Entra nella cartella backend per installare dipendenze
    cd backend
    log "Installazione dipendenze..."
    npm install
    
    # Torna alla root per il build SAM
    cd ../
    
    # Build con SAM
    log "Build SAM..."
    sam build -t infra/sam-template-simple.yaml
    
    success "Build completato"
}

# Deploy dell'infrastruttura
deploy_infrastructure() {
    log "Deploy dell'infrastruttura..."
    
    # Crea bucket S3 se non esiste
    log "Creazione bucket S3: $SAM_BUCKET"
    if ! aws s3 ls "s3://${SAM_BUCKET}" 2>/dev/null; then
        aws s3 mb "s3://${SAM_BUCKET}" --region "$AWS_REGION"
        log "Bucket S3 creato: $SAM_BUCKET"
    else
        log "Bucket S3 già esistente: $SAM_BUCKET"
    fi
    
    # Deploy con SAM
    sam deploy \
        --template-file .aws-sam/build/template.yaml \
        --stack-name "$STACK_NAME" \
        --s3-bucket "$SAM_BUCKET" \
        --capabilities CAPABILITY_IAM \
        --region "$AWS_REGION" \
        --parameter-overrides \
            Environment="$ENVIRONMENT" \
            AllowedOrigins="${ALLOWED_ORIGINS:-}"
        --no-confirm-changeset
    
    success "Deploy completato"
}

# Ottieni output dello stack
get_stack_outputs() {
    log "Recupero output dello stack..."
    
    OUTPUTS=$(aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        --region "$AWS_REGION" \
        --query 'Stacks[0].Outputs' \
        --output json)
    
    API_URL=$(echo "$OUTPUTS" | jq -r '.[] | select(.OutputKey=="ApiUrl") | .OutputValue')
    if [ "$API_URL" = "null" ]; then
        error "Impossibile recuperare gli output dello stack"
        exit 1
    fi
    
    success "Output dello stack:"
    echo "  API URL: $API_URL"
    
    # Salva la configurazione
    cat > config.json << EOF
{
    "environment": "$ENVIRONMENT",
    "apiUrl": "$API_URL",
    "region": "$AWS_REGION",
    "stackName": "$STACK_NAME"
}
EOF
    
    success "Configurazione salvata in config.json"
}

# Test del deployment
test_deployment() {
    log "Test del deployment..."
    
    # Test health endpoint
    HEALTH_URL="${API_URL}/health"
    
    log "Test health endpoint: $HEALTH_URL"
    
    HEALTH_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL")
    
    if [ "$HEALTH_RESPONSE" = "200" ]; then
        success "Health endpoint OK"
    else
        error "Health endpoint failed (HTTP $HEALTH_RESPONSE)"
        exit 1
    fi
    
    # Test summarize endpoint (requires a configured user/session)
    log "Test summarize endpoint..."
    
    TEST_RESPONSE=$(curl -s -w "%{http_code}" \
        -H "Content-Type: application/json" \
        -d '{
            "url": "https://example.com",
            "title": "Test Page",
            "text": "This is a test page with some content for summarization. It has enough text to be processed by the AI model.",
            "lang": "en"
        }' \
        "${API_URL}/summarize")
    
    HTTP_CODE=$(echo "$TEST_RESPONSE" | tail -c 4)
    
    if [ "$HTTP_CODE" = "200" ]; then
        success "API endpoint funziona correttamente"
    else
        warning "API endpoint ha risposto con HTTP $HTTP_CODE"
        warning "Questo potrebbe essere normale se OpenAI API Key non è configurato correttamente"
    fi
}

# Cleanup in caso di errore
cleanup() {
    if [ $? -ne 0 ]; then
        error "Deploy fallito. Puoi fare cleanup con:"
        error "  aws cloudformation delete-stack --stack-name $STACK_NAME --region $AWS_REGION"
        error "  aws s3 rb s3://$SAM_BUCKET --force"
    fi
}

# Main function
main() {
    log "Inizio deploy di LemonSqueezer backend..."
    
    # Trap per cleanup
    trap cleanup EXIT
    
    # Verifica prerequisiti
    check_prerequisites
    
    # Setup parametri
    setup_parameters
    
    # Build
    build_project
    
    # Deploy
    deploy_infrastructure
    
    # Ottieni output
    get_stack_outputs
    
    # Test
    test_deployment
    
    success "Deploy completato con successo!"
    echo
    log "Prossimi passi:"
    log "1. Copia l'API URL e l'API Key nell'estensione"
    log "2. Carica l'estensione in Chrome da: extension/"
    log "3. Testa l'estensione su una pagina web"
    echo
    log "Per rimuovere l'infrastruttura:"
    log "  aws cloudformation delete-stack --stack-name $STACK_NAME --region $AWS_REGION"
}

# Esegui main se script chiamato direttamente
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
