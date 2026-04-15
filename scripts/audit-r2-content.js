#!/usr/bin/env node

/**
 * Diagnostic script to audit R2 bucket content
 * This helps identify what files are actually stored and their date prefixes
 */

import { config } from 'dotenv';
config();

import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'ainewsletter';

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
  console.error('❌ Missing R2 credentials. Please check your .env file has:');
  console.error('   - R2_ACCOUNT_ID');
  console.error('   - R2_ACCESS_KEY_ID');
  console.error('   - R2_SECRET_ACCESS_KEY');
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

async function auditR2Content() {
  console.log('🔍 R2 Content Audit');
  console.log('===================\n');
  
  try {
    // Generate date prefixes for the last 14 days
    const today = new Date();
    const datePrefixes = [];
    
    console.log('📅 Checking date prefixes for last 14 days:\n');
    
    for (let i = 0; i < 14; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      datePrefixes.push(dateStr);
      console.log(`   ${i === 0 ? '✓' : ' '} ${dateStr} ${i === 0 ? '(today)' : ''}`);
    }
    
    console.log('\n📁 Collecting file data...\n');
    
    const auditResults = {
      checked_dates: datePrefixes,
      files_by_date: {},
      no_date_files: [],
      total_md_files: 0,
      total_size_bytes: 0,
      date_range_start: datePrefixes[datePrefixes.length - 1],
      date_range_end: datePrefixes[0],
    };
    
    let continuationToken = undefined;
    let totalListed = 0;
    const allFiles = [];
    
    // List all objects in bucket
    do {
      const command = new ListObjectsV2Command({
        Bucket: R2_BUCKET_NAME,
        MaxKeys: 1000,
        ContinuationToken: continuationToken,
      });
      
      const response = await s3.send(command);
      totalListed += response.Contents?.length || 0;
      
      if (response.Contents) {
        allFiles.push(...response.Contents);
        
        // Process each file
        for (const obj of response.Contents) {
          const key = obj.Key;
          const size = obj.Size;
          
          // Only process .md files
          if (!key.endsWith('.md')) continue;
          
          auditResults.total_md_files++;
          auditResults.total_size_bytes += size;
          
          // Extract date prefix (everything before first underscore)
          const underscoreIndex = key.indexOf('_');
          if (underscoreIndex > 0) {
            const datePrefix = key.substring(0, underscoreIndex);
            
            // Check if this date is in our audit range
            if (datePrefixes.includes(datePrefix)) {
              if (!auditResults.files_by_date[datePrefix]) {
                auditResults.files_by_date[datePrefix] = [];
              }
              auditResults.files_by_date[datePrefix].push({
                key,
                size,
                date_modified: obj.LastModified,
              });
            }
          } else if (key.startsWith('no-date_')) {
            auditResults.no_date_files.push({
              key,
              size,
              date_modified: obj.LastModified,
            });
          }
        }
      }
      
      continuationToken = response.NextContinuationToken;
      process.stdout.write(`   Listed ${allFiles.length} objects...\r`);
    } while (continuationToken);
    
    console.log(`   Listed ${allFiles.length} total objects\n`);
    console.log('📊 Results:\n');
    
    // Display summary by date
    console.log('Content by Date:');
    console.log('────────────────');
    
    datePrefixes.forEach(date => {
      const files = auditResults.files_by_date[date] || [];
      const count = files.length;
      const totalSize = files.reduce((sum, f) => sum + f.size, 0);
      
      const icon = count > 0 ? '✅' : '❌';
      const sizeStr = totalSize > 0 ? ` (${Math.round(totalSize / 1024)}KB)` : ' (0KB)';
      const todayStr = date === datePrefixes[0] ? ' ← TODAY' : '';
      
      console.log(`${icon} ${date}: ${count} files${sizeStr}${todayStr}`);
    });
    
    // Show no-date files
    if (auditResults.no_date_files.length > 0) {
      console.log(`\n⚠️  "no-date" files: ${auditResults.no_date_files.length} files`);
      auditResults.no_date_files.slice(0, 5).forEach(f => {
        console.log(`   - ${f.key}`);
      });
      if (auditResults.no_date_files.length > 5) {
        console.log(`   ... and ${auditResults.no_date_files.length - 5} more`);
      }
    }
    
    // Show overall summary
    console.log(`\n📈 Summary:`);
    console.log('──────────');
    const datesWithContent = Object.keys(auditResults.files_by_date).filter(
      date => auditResults.files_by_date[date].length > 0
    ).length;
    
    console.log(`Total dates checked: ${datePrefixes.length}`);
    console.log(`Dates with content: ${datesWithContent}`);
    console.log(`Total .md files found: ${auditResults.total_md_files}`);
    console.log(`Total size: ${Math.round(auditResults.total_size_bytes / (1024 * 1024))}MB`);
    console.log(`Date range: ${auditResults.date_range_start} to ${auditResults.date_range_end}`);
    
    // Show specific date recommendations
    console.log(`\n💡 Analysis:`);
    console.log('───────────');
    
    // Check last 7 days specifically
    const last7Days = datePrefixes.slice(0, 7);
    const hasContentIn7Days = last7Days.some(date => 
      (auditResults.files_by_date[date] || []).length > 0
    );
    
    if (hasContentIn7Days) {
      console.log('✅ Content found in last 7 days - generation should succeed');
    } else {
      console.log('❌ No content found in last 7 days - this explains generation failure');
      
      // Check next 7 days
      const next7Days = datePrefixes.slice(7, 14);
      const hasContentIn14Days = next7Days.some(date => 
        (auditResults.files_by_date[date] || []).length > 0
      );
      
      if (hasContentIn14Days) {
        console.log('✅ Content found in days 8-14 - expanding search range would help');
      } else {
        console.log('❌ No content found even in 14-day range - investigate upload pipeline');
      }
    }
    
    // Save detailed results to file
    const fs = await import('fs');
    const outputFile = `r2-audit-${new Date().toISOString().split('T')[0]}.json`;
    fs.writeFileSync(outputFile, JSON.stringify(auditResults, null, 2));
    console.log(`\n💾 Full audit saved to: ${outputFile}`);
    
    console.log('\n✅ Audit complete!');
    
  } catch (error) {
    console.error('\n❌ Audit failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the audit
console.log('🚀 Starting R2 content audit...\n');
auditR2Content().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
