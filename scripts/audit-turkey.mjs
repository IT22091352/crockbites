async function checkTurkey() {
  const res = await fetch('https://crockbites.site/recipe/juicy-slow-cooker-turkey-breast/');
  const html = await res.text();
  console.log('Turkey page status:', res.status);
  console.log('Contains nutrition in text:', html.includes('Nutrition') || html.includes('nutrition') || html.includes('Calories') || html.includes('Total Fat'));
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (m) {
    const json = JSON.parse(m[1]);
    console.log('JSON-LD nutrition:', json.nutrition);
  }
}

checkTurkey();

