#!/bin/bash

# TLDR Test Suite Completa
# Data: 08/10/2025

set -e

# Colori per output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configurazione
API_URL="https://4jo5gamel9.execute-api.eu-west-1.amazonaws.com/dev"
JWT_SECRET="dea250f0b33485d68af396a0f8dee425d27158ba2ecbb293bf3e15799d8954ca"
TEST_USER_ID="test-user-123"
TEST_USER_EMAIL="test@example.com"

# Contatori
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Funzioni helper
print_header() {
    echo -e "\n${BLUE}============================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}============================================${NC}\n"
}

print_test() {
    echo -e "${YELLOW}[TEST]${NC} $1"
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
}

print_success() {
    echo -e "${GREEN}✓ PASS${NC} $1"
    PASSED_TESTS=$((PASSED_TESTS + 1))
}

print_fail() {
    echo -e "${RED}✗ FAIL${NC} $1"
    FAILED_TESTS=$((FAILED_TESTS + 1))
}

# Genera JWT token
generate_token() {
    cd "$(dirname "$0")/../backend" && node -e "
        const jwt = require('jsonwebtoken');
        console.log(jwt.sign({
            userId: '$TEST_USER_ID',
            email: '$TEST_USER_EMAIL'
        }, '$JWT_SECRET', {expiresIn: '1h'}));
    " && cd - > /dev/null
}

# ============================================
# TEST INFRASTRUCTURE
# ============================================
print_header "TEST 1: INFRASTRUCTURE & AWS RESOURCES"

# Test 1.1: Lambda esiste
print_test "Lambda function exists"
if aws lambda get-function --function-name lemonsqueezer-summarize-dev --region eu-west-1 > /dev/null 2>&1; then
    print_success "Lambda lemonsqueezer-summarize-dev exists"
else
    print_fail "Lambda not found"
fi

# Test 1.2: DynamoDB Tables
print_test "DynamoDB tables exist"
TABLES=(
    "lemonsqueezer-users-dev"
    "lemonsqueezer-subscriptions-dev"
    "lemonsqueezer-payments-dev"
    "lemonsqueezer-cache-dev"
    "lemonsqueezer-rate-limit-dev"
    "lemonsqueezer-analytics-dev"
)

for table in "${TABLES[@]}"; do
    if aws dynamodb describe-table --table-name "$table" --region eu-west-1 > /dev/null 2>&1; then
        print_success "Table $table exists"
    else
        print_fail "Table $table not found"
    fi
done

# Test 1.3: Parameter Store secrets
print_test "Parameter Store secrets configured"
PARAMS=(
    "/lemonsqueezer/dev/openai-api-key"
    "/lemonsqueezer/dev/jwt-secret"
    "/lemonsqueezer/dev/stripe-secret-key"
    "/lemonsqueezer/dev/stripe-webhook-secret"
)

for param in "${PARAMS[@]}"; do
    if aws ssm get-parameter --name "$param" --region eu-west-1 > /dev/null 2>&1; then
        print_success "Parameter $param exists"
    else
        print_fail "Parameter $param not found"
    fi
done

# ============================================
# TEST API ENDPOINTS
# ============================================
print_header "TEST 2: API GATEWAY & ENDPOINTS"

# Test 2.1: Health check
print_test "GET /health (no auth)"
response=$(curl -s -w "\n%{http_code}" "$API_URL/health")
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | head -n1)

if [ "$http_code" = "200" ]; then
    print_success "Health endpoint returns 200"
else
    print_fail "Health endpoint returned $http_code"
fi

# Test 2.2: OPTIONS (CORS preflight)
print_test "OPTIONS /{proxy+} (CORS)"
http_code=$(curl -s -o /dev/null -w "%{http_code}" -X OPTIONS "$API_URL/summarize-url")

if [ "$http_code" = "200" ]; then
    print_success "CORS preflight works"
else
    print_fail "CORS preflight failed with $http_code"
fi

# ============================================
# TEST AUTHENTICATION
# ============================================
print_header "TEST 3: AUTHENTICATION & JWT"

# Genera token
TOKEN=$(generate_token)

# Test 3.1: Request senza token
print_test "Request without Authorization header"
response=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/summarize-url" \
    -H "Content-Type: application/json" \
    -d '{"url":"https://example.com","text":"test","language":"en"}')

if [ "$response" = "401" ] || [ "$response" = "403" ]; then
    print_success "Unauthorized request rejected (HTTP $response)"
else
    print_fail "Expected 401/403, got $response"
fi

# Test 3.2: Request con token valido
print_test "Request with valid JWT token"
response=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/summarize-url" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{
        "url": "https://www.example.com",
        "title": "Test",
        "text": "This domain is for use in illustrative examples in documents. You may use this domain in literature without prior coordination or asking for permission. This is a longer text to make sure we have enough content for the summarization to work properly.",
        "language": "en"
    }')

http_code=$(echo "$response" | tail -1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" = "200" ]; then
    print_success "Authenticated request accepted"
    
    # Verifica presenza campi nella risposta
    if echo "$body" | jq -e '.summary' > /dev/null 2>&1; then
        print_success "Response contains 'summary' field"
    else
        print_fail "Response missing 'summary' field"
    fi
    
    if echo "$body" | jq -e '.stats' > /dev/null 2>&1; then
        print_success "Response contains 'stats' field"
    else
        print_fail "Response missing 'stats' field"
    fi
else
    print_fail "Authenticated request failed with HTTP $http_code"
    echo "Response: $body"
fi

# Test 3.3: Token con signature errata
print_test "Request with invalid JWT signature"
INVALID_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ0ZXN0IiwiZW1haWwiOiJ0ZXN0QGV4YW1wbGUuY29tIn0.INVALID_SIGNATURE"
response=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/summarize-url" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $INVALID_TOKEN" \
    -d '{"url":"https://example.com","text":"test","language":"en"}')

if [ "$response" = "401" ] || [ "$response" = "403" ]; then
    print_success "Invalid token rejected (HTTP $response)"
else
    print_fail "Expected 401/403, got $response"
fi

# ============================================
# TEST OPENAI INTEGRATION
# ============================================
print_header "TEST 4: OPENAI SUMMARIZATION"

# Test 4.1: Summarization con diverse lingue
LANGUAGES=("en" "it" "es" "fr" "de")

for lang in "${LANGUAGES[@]}"; do
    print_test "Summarization in $lang"
    response=$(curl -s -X POST "$API_URL/summarize-url" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $TOKEN" \
        -d '{
            "url": "https://www.example.com",
            "title": "Test",
            "text": "This is a test content for summarization. It needs to be long enough to trigger OpenAI processing. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
            "language": "'$lang'"
        }')
    
    if echo "$response" | jq -e '.summary' > /dev/null 2>&1; then
        summary=$(echo "$response" | jq -r '.summary')
        if [ ${#summary} -gt 10 ]; then
            print_success "Generated summary for $lang (${#summary} chars)"
        else
            print_fail "Summary too short for $lang"
        fi
    else
        print_fail "No summary generated for $lang"
        echo "Response: $response"
    fi
done

# Test 4.2: Contenuto troppo corto
print_test "Short content rejection"
response=$(curl -s -X POST "$API_URL/summarize-url" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{
        "url": "https://example.com",
        "title": "Test",
        "text": "Short",
        "language": "en"
    }')

if echo "$response" | jq -e '.error' > /dev/null 2>&1; then
    print_success "Short content rejected with error"
else
    print_fail "Short content should be rejected"
fi

# ============================================
# TEST DYNAMODB OPERATIONS
# ============================================
print_header "TEST 5: DYNAMODB DATA OPERATIONS"

# Test 5.1: User lookup
print_test "User exists in DynamoDB"
response=$(aws dynamodb get-item \
    --table-name lemonsqueezer-users-dev \
    --key '{"id":{"S":"'$TEST_USER_ID'"}}' \
    --region eu-west-1)

if echo "$response" | jq -e '.Item' > /dev/null 2>&1; then
    print_success "Test user found in DynamoDB"
else
    print_fail "Test user not found in DynamoDB"
fi

# Test 5.2: Analytics tracking (verifica che la tabella sia scrivibile)
print_test "Analytics table is writable"
EVENT_ID="test-event-$(date +%s)"
if aws dynamodb put-item \
    --table-name lemonsqueezer-analytics-dev \
    --item '{
        "eventId": {"S": "'$EVENT_ID'"},
        "timestamp": {"N": "'$(date +%s)'"},
        "userId": {"S": "'$TEST_USER_ID'"},
        "eventType": {"S": "test_event"}
    }' \
    --region eu-west-1 > /dev/null 2>&1; then
    print_success "Analytics table writable"
    
    # Cleanup
    aws dynamodb delete-item \
        --table-name lemonsqueezer-analytics-dev \
        --key '{"eventId":{"S":"'$EVENT_ID'"}}' \
        --region eu-west-1 > /dev/null 2>&1
else
    print_fail "Cannot write to Analytics table"
fi

# ============================================
# TEST RATE LIMITING
# ============================================
print_header "TEST 6: RATE LIMITING"

# Test 6.1: Rate limit table structure
print_test "Rate limit table accessible"
if aws dynamodb describe-table --table-name lemonsqueezer-rate-limit-dev --region eu-west-1 > /dev/null 2>&1; then
    print_success "Rate limit table accessible"
    
    # Verifica TTL enabled
    ttl_status=$(aws dynamodb describe-time-to-live \
        --table-name lemonsqueezer-rate-limit-dev \
        --region eu-west-1 \
        --query 'TimeToLiveDescription.TimeToLiveStatus' \
        --output text)
    
    if [ "$ttl_status" = "ENABLED" ]; then
        print_success "TTL enabled on rate limit table"
    else
        print_fail "TTL not enabled on rate limit table"
    fi
else
    print_fail "Rate limit table not accessible"
fi

# ============================================
# TEST CACHE
# ============================================
print_header "TEST 7: CACHE FUNCTIONALITY"

# Test 7.1: Cache table TTL
print_test "Cache table TTL configuration"
ttl_status=$(aws dynamodb describe-time-to-live \
    --table-name lemonsqueezer-cache-dev \
    --region eu-west-1 \
    --query 'TimeToLiveDescription.TimeToLiveStatus' \
    --output text)

if [ "$ttl_status" = "ENABLED" ]; then
    print_success "TTL enabled on cache table"
else
    print_fail "TTL not enabled on cache table"
fi

# ============================================
# TEST STRIPE (se configurato)
# ============================================
print_header "TEST 8: STRIPE INTEGRATION"

# Test 8.1: Stripe secret configurato
print_test "Stripe secret in Parameter Store"
if aws ssm get-parameter \
    --name /lemonsqueezer/dev/stripe-secret-key \
    --region eu-west-1 > /dev/null 2>&1; then
    print_success "Stripe secret configured"
else
    print_fail "Stripe secret not configured"
fi

# Test 8.2: Price IDs configurati
print_test "Stripe Price IDs configured"
monthly_price=$(aws ssm get-parameter \
    --name /lemonsqueezer/dev/stripe-premium-monthly-price-id \
    --region eu-west-1 \
    --query 'Parameter.Value' \
    --output text 2>/dev/null)

if [ ! -z "$monthly_price" ] && [ "$monthly_price" != "None" ]; then
    print_success "Stripe monthly price ID: $monthly_price"
else
    print_fail "Stripe monthly price ID not configured"
fi

# ============================================
# TEST PERFORMANCE
# ============================================
print_header "TEST 9: PERFORMANCE & LATENCY"

# Test 9.1: Response time
print_test "API response time"
start_time=$(date +%s%N)
response=$(curl -s -X POST "$API_URL/summarize-url" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{
        "url": "https://www.example.com",
        "title": "Performance Test",
        "text": "This is a performance test to measure response time. The content needs to be long enough to trigger proper OpenAI processing. We want to ensure the system responds within acceptable time limits.",
        "language": "en"
    }')
end_time=$(date +%s%N)
elapsed_ms=$(( (end_time - start_time) / 1000000 ))

if [ $elapsed_ms -lt 10000 ]; then
    print_success "Response time: ${elapsed_ms}ms (< 10s)"
else
    print_fail "Response time: ${elapsed_ms}ms (> 10s)"
fi

# Test 9.2: Lambda cold start (verifica logs)
print_test "Lambda execution logs"
if aws logs filter-log-events \
    --log-group-name /aws/lambda/lemonsqueezer-summarize-dev \
    --region eu-west-1 \
    --limit 1 > /dev/null 2>&1; then
    print_success "Lambda logs accessible"
else
    print_fail "Cannot access Lambda logs"
fi

# ============================================
# TEST ERROR HANDLING
# ============================================
print_header "TEST 10: ERROR HANDLING"

# Test 10.1: Invalid JSON
print_test "Invalid JSON payload"
response=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/summarize-url" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{invalid json}')

http_code=$(echo "$response" | tail -n1)
if [ "$http_code" = "400" ] || [ "$http_code" = "500" ]; then
    print_success "Invalid JSON rejected (HTTP $http_code)"
else
    print_fail "Expected 400/500, got $http_code"
fi

# Test 10.2: Missing required fields
print_test "Missing required fields"
response=$(curl -s -X POST "$API_URL/summarize-url" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"url":"https://example.com"}')

if echo "$response" | jq -e '.error' > /dev/null 2>&1; then
    print_success "Missing fields rejected with error"
else
    print_fail "Missing fields should be rejected"
fi

# ============================================
# SUMMARY
# ============================================
print_header "TEST SUMMARY"

echo -e "Total tests: ${BLUE}$TOTAL_TESTS${NC}"
echo -e "Passed: ${GREEN}$PASSED_TESTS${NC}"
echo -e "Failed: ${RED}$FAILED_TESTS${NC}"

if [ $FAILED_TESTS -eq 0 ]; then
    echo -e "\n${GREEN}✓ ALL TESTS PASSED!${NC}\n"
    exit 0
else
    echo -e "\n${RED}✗ SOME TESTS FAILED${NC}\n"
    exit 1
fi
