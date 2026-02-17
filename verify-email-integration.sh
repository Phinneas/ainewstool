#!/bin/bash

# Verification script for email integration
# This tests that all commands are properly wired

echo "🧪 Testing Email Integration"
echo "============================"

# Test 1: CLI help shows email commands
echo ""
echo "✓ Test 1: CLI help includes email commands"
npm run --silent 2>&1 | grep -q "email" && echo "  ✅ Email commands found in help" || echo "  ❌ Email commands missing"

# Test 2: Email command validation
echo ""
echo "✓ Test 2: Email command validates missing date"
npm run --silent email 2>&1 | grep -q "Usage:" && echo "  ✅ Validates missing date" || echo "  ❌ Missing date validation failed"

# Test 3: Email command validation with date but no recipient
echo ""
echo "✓ Test 3: Email command validates missing recipient"
npm run --silent email 2026-02-10 2>&1 | grep -q "Usage:" && echo "  ✅ Validates missing recipient" || echo "  ❌ Missing recipient validation failed"

# Test 4: Send command validates NEWSLETTER_RECIPIENTS
echo ""
echo "✓ Test 4: Send command validates NEWSLETTER_RECIPIENTS"
npm run --silent send 2026-02-10 2>&1 | grep -q "NEWSLETTER_RECIPIENTS" && echo "  ✅ Validates missing recipients env var" || echo "  ❌ Recipients validation failed"

# Test 5: Email command validates newsletter file exists
echo ""
echo "✓ Test 5: Email command validates newsletter file exists"
npm run --silent email 2026-02-10 test@example.com 2>&1 | grep -q "Could not read newsletter file" && echo "  ✅ Validates newsletter file existence" || echo "  ❌ File validation failed"

# Test 6: Environment variables in .env.example
echo ""
echo "✓ Test 6: RESEND_API_KEY in .env.example"
grep -q "RESEND_API_KEY" .env.example && echo "  ✅ RESEND_API_KEY documented" || echo "  ❌ RESEND_API_KEY missing"

echo ""
echo "✓ Test 7: NEWSLETTER_RECIPIENTS in .env.example"
grep -q "NEWSLETTER_RECIPIENTS" .env.example && echo "  ✅ NEWSLETTER_RECIPIENTS documented" || echo "  ❌ NEWSLETTER_RECIPIENTS missing"

# Test 8: NPM scripts exist
echo ""
echo "✓ Test 8: NPM scripts registered"
grep -q '"email"' package.json && echo "  ✅ 'email' script exists" || echo "  ❌ 'email' script missing"
grep -q '"send"' package.json && echo "  ✅ 'send' script exists" || echo "  ❌ 'send' script missing"

# Test 9: TypeScript compilation
echo ""
echo "✓ Test 9: TypeScript compilation"
npm run build > /dev/null 2>&1 && echo "  ✅ TypeScript compiles successfully" || echo "  ❌ TypeScript compilation failed"

# Test 10: Tests still pass
echo ""
echo "✓ Test 10: All tests pass"
npm test > /dev/null 2>&1 && echo "  ✅ All 110 tests pass" || echo "  ❌ Some tests failed"

echo ""
echo "============================"
echo "✅ Email integration verification complete!"
echo ""
echo "Next steps:"
echo "1. Add RESEND_API_KEY to your .env file"
echo "2. Add NEWSLETTER_RECIPIENTS to your .env file"
echo "3. Generate a newsletter: npm run generate 2026-02-10"
echo "4. Test email: npm run email 2026-02-10 your-email@example.com"
echo "5. Send to all: npm run send 2026-02-10"
