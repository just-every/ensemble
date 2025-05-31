#!/bin/bash
# Local script to fetch and update model data

echo "🚀 Ensemble Model Data Updater"
echo "=============================="
echo ""

# Check for required environment variable
if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo "❌ Error: ANTHROPIC_API_KEY not set in .env"
    echo "Please ensure you have a .env file with ANTHROPIC_API_KEY"
    exit 1
fi

echo "📅 Date: $(date)"
echo ""

# Step 1: Fetch model data dynamically
echo "🔍 Step 1: Fetching latest model data..."
echo "---------------------------------------"
npx tsx scripts/fetch-model-data-dynamic.ts
if [ $? -ne 0 ]; then
    echo "❌ Failed to fetch model data"
    exit 1
fi
echo ""

# Step 2: Generate summary
echo "📊 Step 2: Generating summary..."
echo "-------------------------------"
if [ -f "model-search-results-dynamic.json" ]; then
    # Quick summary using jq if available
    if command -v jq &> /dev/null; then
        echo "Models found by provider:"
        jq -r '.models | group_by(.provider) | .[] | "\(.[0].provider): \(length) models"' model-search-results-dynamic.json
    fi
fi
echo ""

# Step 3: Optional validation
echo "🧪 Step 3: Validation (optional)"
echo "-------------------------------"
echo "Would you like to run validation? (y/n)"
read -r response
if [[ "$response" =~ ^[Yy]$ ]]; then
    echo "Running cross-validation..."
    npx tsx scripts/cross-validate-data.ts || echo "Cross-validation completed with issues"
    
    echo ""
    echo "Running API tests..."
    npx tsx scripts/test-new-models.ts || echo "API tests completed with issues"
fi
echo ""

# Step 4: Show results
echo "✅ Step 4: Results"
echo "-----------------"
echo "Generated files:"
echo "  - model-data-dynamic.ts (TypeScript code)"
echo "  - model-search-results-dynamic.json (Raw data)"

if [ -f "*-report.json" ]; then
    echo "  - Validation reports"
fi

echo ""
echo "To use the updated data:"
echo "1. Review model-data-dynamic.ts"
echo "2. Copy relevant entries to model_data.ts"
echo "3. Run tests to ensure everything works"
echo ""
echo "To see a nice summary:"
echo "  cat model-search-results-dynamic.json | jq '.metadata'"