// ISO 3166-1 alpha-2 codes; English names are generated with Intl.DisplayNames
const CODES = ('AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FR GA GB GD GE GH GM GN GQ GR GT GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KM KN KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MK ML MM MN MO MR MT MU MV MW MX MY MZ NA NC NE NG NI NL NO NP NZ OM PA PE PF PG PH PK PL PR PS PT PY QA RE RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM TN TO TR TT TW TZ UA UG US UY UZ VA VC VE VN VU WS XK YE ZA ZM ZW').split(' ');

let names;
try { names = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { names = null; }

const COUNTRIES = CODES.map((code) => ({
  code,
  name: code === 'XK' ? 'Kosovo' : (names ? names.of(code) : code),
})).sort((a, b) => a.name.localeCompare(b.name, 'en'));

const COUNTRY_BY_CODE = Object.fromEntries(COUNTRIES.map((c) => [c.code, c]));

// Region suggestions (players may also type any region)
const REGION_SUGGESTIONS = {
  FR: ['Auvergne-Rhône-Alpes', 'Bourgogne-Franche-Comté', 'Bretagne', 'Centre-Val de Loire', 'Corse',
    'Grand Est', 'Hauts-de-France', 'Île-de-France', 'Normandie', 'Nouvelle-Aquitaine', 'Occitanie',
    'Pays de la Loire', "Provence-Alpes-Côte d'Azur", 'Guadeloupe', 'Martinique', 'Guyane', 'La Réunion', 'Mayotte'],
  BE: ['Brussels-Capital', 'Flanders', 'Wallonia'],
  CH: ['Romandy', 'German-speaking Switzerland', 'Italian-speaking Switzerland'],
  CA: ['Alberta', 'British Columbia', 'Manitoba', 'New Brunswick', 'Newfoundland and Labrador', 'Nova Scotia', 'Ontario', 'Prince Edward Island', 'Quebec', 'Saskatchewan'],
  GB: ['England', 'Northern Ireland', 'Scotland', 'Wales'],
};

module.exports = { COUNTRIES, COUNTRY_BY_CODE, REGION_SUGGESTIONS };
