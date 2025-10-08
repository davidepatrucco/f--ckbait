#!/bin/bash

# create-local-tables.sh - Crea tabelle DynamoDB per test locali

echo "🚀 Creazione tabelle DynamoDB locali per LemonSqueezer..."

# Configurazione
REGION="eu-west-1"
TABLE_NAME="tldr-users-dev"

# Funzione per creare tabella se non esiste
create_table_if_not_exists() {
    local table_name=$1
    
    # Verifica se la tabella esiste già
    aws dynamodb describe-table --table-name "$table_name" --region "$REGION" >/dev/null 2>&1
    
    if [ $? -eq 0 ]; then
        echo "✅ Tabella $table_name già esistente"
    else
        echo "📝 Creazione tabella $table_name..."
        
        aws dynamodb create-table \
            --table-name "$table_name" \
            --attribute-definitions \
                AttributeName=id,AttributeType=S \
            --key-schema \
                AttributeName=id,KeyType=HASH \
            --billing-mode PAY_PER_REQUEST \
            --region "$REGION"
        
        if [ $? -eq 0 ]; then
            echo "✅ Tabella $table_name creata con successo"
        else
            echo "❌ Errore nella creazione della tabella $table_name"
            exit 1
        fi
    fi
}

# Crea la tabella users
create_table_if_not_exists "$TABLE_NAME"

echo ""
echo "🎉 Configurazione completata!"
echo ""
echo "Per testare localmente, usa:"
echo "export USERS_TABLE_NAME=$TABLE_NAME"
echo "export AWS_REGION=$REGION"
echo ""
echo "Per visualizzare i dati:"
echo "aws dynamodb scan --table-name $TABLE_NAME --region $REGION"