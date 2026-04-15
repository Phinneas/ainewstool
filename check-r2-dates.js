#!/usr/bin/env node

/**
 * Diagnostic script to check R2 bucket content dates
 * This helps identify if there's a mismatch between upload and retrieval dates
 */

import { config } from 'dotenv';
config();

// Import R2 client
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'ainewsletter';

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
  console.error('Missing R2 credentials. Please set:');
  console.error('  R2_ACCOUNT_ID');
  console.error('  R2_ACCESS_KEY_ID');
  console.error('  R2_SECRET_ACCESS_KEY');
  process.exit(1);
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

async function checkR2Dates() {
  console.log('🔍 Checking R2 bucket for date patterns...\n');
  
  try {
    const today = new Date();
    const datesToCheck = [];
    
    // Generate last 14 days
    for (let i = 0; i < 14; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      datesToCheck.push(dateStr);
    }
    
    console.log('📅 Dates to check (last 14 days):');
    datesToCheck.forEach(date => console.log(`   ${date}`));
    console.log();
    
    // Check each date prefix
    for (const date of datesToCheck) {
      const prefix = `${date}_`;
      console.log(`\n🔎 Checking prefix: ${prefix}`);
      
      const command = new ListObjectsV2Command({
        Bucket: R2_BUCKET_NAME,
        Prefix: prefix,
        MaxKeys: 10, // Just get a sample
      });
      
      const response = await s3.send(command);
      
      if (response.Contents && response.Contents.length > 0) {
        console.log(`   ✅ Found ${response.Contents.length} files`);
        // Show first 3 files as examples
        response.Contents.slice(0, 3).forEach(obj => {
          const filename = obj.Key.split('/').pop();
          const sizeKb = Math.round(obj.Size / 1024);
          console.log(`      📄 ${filename} (${sizeKb}KB)`);
        });
        if (response.Contents.length > 3) {
          console.log(`      ... and ${response.Contents.length - 3} more`);
        }
      } else {
        console.log(`   ❌ No files found`);
      }
    }
    
    // Also check 'no-date' files
    console.log('\n🔎 Checking "no-date" files:');
    const noDateCommand = new ListObjectsV2Command({
      Bucket: R2_BUCKET_NAME,
      Prefix: 'no-date_',
      MaxKeys: 10,
    });
    
    const noDateResponse = await s3.send(noDateCommand);
    if (noDateResponse.Contents && noDateResponse.Contents.length > 0) {
      console.log(`   ✅ Found ${noDateResponse.Contents.length} files with no date`);
      noDateResponse.Contents.slice(0, 3).forEach(obj => {
        console.log(`      📄 ${obj.Key}`);
      });
    }
    
    console.log('\n✅ Diagnostic complete!');
    
  } catch (error) {
    console.error('❌ Error checking R2:', error);
    process.exit(1);
  }
}

checkR2Dates().catch(console.error);
