#!/usr/bin/env node

/**
 * Debug date generation for newsletter pipeline
 */

// Simulate the date generation from handleGenerateCron
function generateNewsletterDates() {
  const today = new Date();
  const dates = [];
  
  console.log('Current date:', today.toISOString());
  console.log('UTC Date:', today.toUTCString());
  
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    dates.push(dateStr);
    console.log(`  Date ${i}: ${dateStr} (UTC: ${d.toUTCString()})`);
  }
  
  return dates;
}

// Simulate filename generation
function generateSampleFilenames(dates) {
  console.log('\nSample filenames that would be generated:');
  
  dates.forEach(date => {
    const sampleUrls = [
      'https://www.example.com/article/ai-news-today',
      'https://techcrunch.com/2024/04/14/ai-breakthrough',
      'https://arxiv.org/abs/2404.12345'
    ];
    
    sampleUrls.forEach(url => {
      const urlObj = new URL(url);
      const path = urlObj.pathname || '/';
      const slug = path
        .replace(/[^a-zA-Z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      
      const sourceName = urlObj.hostname.replace('www.', '');
      const filename = `${date}_${sourceName}_${slug || 'index'}`.substring(0, 200);
      console.log(`  ${filename}`);
    });
  });
}

console.log('===== Newsletter Date Generation Debug =====\n');
const dates = generateNewsletterDates();
console.log('\nDates array:', dates);
generateSampleFilenames(dates);

// Check today's date in different formats
const now = new Date();
console.log('\n===== Current Time Debug =====');
console.log('Local time:', now.toString());
console.log('UTC time:', now.toUTCString());
console.log('ISO string:', now.toISOString());
console.log('UTC Date part:', now.toISOString().slice(0, 10));

// Check if it's been run today
const lastWednesday = new Date();
const daysSinceWednesday = (lastWednesday.getDay() + 4) % 7; // Days since last Wed
lastWednesday.setDate(lastWednesday.getDate() - daysSinceWednesday);
console.log('\nLast Wednesday:', lastWednesday.toISOString().slice(0, 10));

const lastSaturday = new Date();
const daysSinceSaturday = (lastSaturday.getDay() + 1) % 7; // Days since last Sat
lastSaturday.setDate(lastSaturday.getDate() - daysSinceSaturday);
console.log('Last Saturday:', lastSaturday.toISOString().slice(0, 10));
