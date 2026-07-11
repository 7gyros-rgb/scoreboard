const https = require('https');

https.get('https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=20260611-20260719&limit=100', res => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const json = JSON.parse(data);
    const matches = json.events || [];
    
    console.log('\n========== STOPPAGE TIME DEBUG ==========\n');
    
    matches.forEach((match, idx) => {
      const comp = match.competitions?.[0];
      if (!comp) return;
      
      const competitors = comp.competitors || [];
      const teams = competitors.map(c => c.team?.abbreviation).join(' vs ');
      
      console.log(`\n[Match ${idx}] ${teams}`);
      console.log('Status:', comp.status?.type?.description);
      console.log('Status name:', comp.status?.type?.name);
      
      // Check various possible locations for added time
      console.log('\n--- Clock/Time Info ---');
      console.log('displayClock:', comp.displayClock);
      console.log('clock:', JSON.stringify(comp.clock, null, 2));
      
      console.log('\n--- Details Array (raw) ---');
      if (comp.details && comp.details.length > 0) {
        comp.details.forEach((detail, i) => {
          console.log(`\n  Detail ${i}:`);
          console.log('    text:', detail.text);
          console.log('    shortText:', detail.shortText);
          console.log('    displayValue:', detail.displayValue);
          console.log('    type:', detail.type);
          console.log('    clock:', detail.clock);
        });
      } else {
        console.log('(No details array)');
      }
      
      console.log('\n--- Other Possible Fields ---');
      console.log('liveStatus:', comp.liveStatus);
      console.log('updated:', comp.updated);
      console.log('status.displayClock:', comp.status?.displayClock);
      
      // Check note object
      console.log('\n--- Note/Broadcast Info ---');
      console.log('note:', comp.note);
      console.log('broadcasts:', JSON.stringify(comp.broadcasts, null, 2).substring(0, 200));
      
      // Check if there's a situation object
      console.log('\n--- Situation ---');
      if (comp.situation) {
        console.log(JSON.stringify(comp.situation, null, 2).substring(0, 300));
      }
    });
  });
}).on('error', e => console.error('ERROR:', e.message));
