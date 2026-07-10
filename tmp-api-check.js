const https = require('https');
https.get('https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=20260611-20260719&limit=100', res => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const json = JSON.parse(data);
    const teams = (json.events?.[0]?.competitions?.[0]?.competitors) || [];
    teams.forEach(team => {
      const t = team.team || {};
      console.log('---');
      console.log('displayName:', t.displayName);
      console.log('abbreviation:', t.abbreviation);
      console.log('id:', t.id);
      console.log('keys:', Object.keys(t).sort().join(', '));
      const colorKeys = ['color','primaryColor','secondaryColor','alternateColor','jersey','hex','rgb','teamColor','backgroundColor'];
      colorKeys.forEach(k => {
        if (t[k] !== undefined) console.log(k + ':', JSON.stringify(t[k]));
      });
    });
  });
}).on('error', e => console.error('ERR', e.message));
