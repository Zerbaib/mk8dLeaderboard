// ISO 3166-1 alpha-2 codes; English names are generated with Intl.DisplayNames
const CODES = ('AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FR GA GB GD GE GH GM GN GQ GR GT GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KM KN KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MK ML MM MN MO MR MT MU MV MW MX MY MZ NA NC NE NG NI NL NO NP NZ OM PA PE PF PG PH PK PL PR PS PT PY QA RE RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM TN TO TR TT TW TZ UA UG US UY UZ VA VC VE VN VU WS XK YE ZA ZM ZW').split(' ');

let names;
try { names = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { names = null; }

const COUNTRIES = CODES.map((code) => ({
  code,
  name: code === 'XK' ? 'Kosovo' : (names ? names.of(code) : code),
})).sort((a, b) => a.name.localeCompare(b.name, 'en'));

const COUNTRY_BY_CODE = Object.fromEntries(COUNTRIES.map((c) => [c.code, c]));

// World regions used for the region leaderboards (derived from the player's country)
const REGIONS = [
  { id: 'europe', name: 'Europe' },
  { id: 'north-america', name: 'North America' },
  { id: 'south-america', name: 'South America' },
  { id: 'asia', name: 'Asia' },
  { id: 'africa', name: 'Africa' },
  { id: 'oceania', name: 'Oceania' },
];

const REGION_CODES = {
  europe: 'AD AL AM AT AZ BA BE BG BY CH CY CZ DE DK EE ES FI FR GB GE GR HR HU IE IS IT LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SK SM TR UA VA XK',
  'north-america': 'AG BB BS BZ CA CR CU DM DO GD GT HN HT JM KN LC MX NI PA PR SV TT US VC',
  'south-america': 'AR BO BR CL CO EC GY PE PY SR UY VE',
  asia: 'AE AF BD BH BN BT CN HK ID IL IN IQ IR JO JP KG KH KR KW KZ LA LB LK MM MN MO MV MY NP OM PH PK PS QA SA SG SY TH TJ TL TM TW UZ VN YE',
  africa: 'AO BF BI BJ BW CD CF CG CI CM CV DJ DZ EG ER ET GA GH GM GN GQ GW KE KM LR LS LY MA MG ML MR MU MW MZ NA NE NG RE RW SC SD SL SN SO SS ST SZ TD TG TN TZ UG ZA ZM ZW',
  oceania: 'AU FJ NC NZ PF PG SB TO VU WS',
};

const REGION_OF = {};
Object.entries(REGION_CODES).forEach(([region, codes]) => codes.split(' ').forEach((c) => { REGION_OF[c] = region; }));
COUNTRIES.forEach((c) => { c.region = REGION_OF[c.code]; });
const REGION_BY_ID = Object.fromEntries(REGIONS.map((r) => [r.id, r]));

module.exports = { COUNTRIES, COUNTRY_BY_CODE, REGIONS, REGION_BY_ID };
