/**
 * Service catalogue. Prices are in paise (integer minor units) and represent
 * the admin's pricing guideline band, not what any one provider charges.
 */
const inr = (rupees) => rupees * 100;

export const categories = [
  {
    name: 'Plumbing',
    slug: 'plumbing',
    icon: 'droplet',
    description: 'Leak repair, tap and pipe fitting, drainage and bathroom plumbing.',
    base: inr(399), min: inr(199), max: inr(5000), minutes: 60,
    children: [
      { name: 'Tap & Mixer Repair', slug: 'tap-mixer-repair', base: inr(249), min: inr(149), max: inr(1200), minutes: 45 },
      { name: 'Leak & Seepage Fix', slug: 'leak-seepage-fix', base: inr(499), min: inr(299), max: inr(3000), minutes: 90 },
      { name: 'Drain Cleaning',   slug: 'drain-cleaning', base: inr(599), min: inr(349), max: inr(2500), minutes: 75 },
      { name: 'Bathroom Fitting', slug: 'bathroom-fitting', base: inr(899), min: inr(499), max: inr(8000), minutes: 120 },
    ],
  },
  {
    name: 'Electrical',
    slug: 'electrical',
    icon: 'zap',
    description: 'Wiring, switches, fans, lighting and electrical safety checks.',
    base: inr(349), min: inr(199), max: inr(6000), minutes: 60,
    certification: true,
    children: [
      { name: 'Switch & Socket Repair', slug: 'switch-socket-repair', base: inr(199), min: inr(129), max: inr(1000), minutes: 30 },
      { name: 'Fan Installation & Repair', slug: 'fan-installation-repair', base: inr(299), min: inr(199), max: inr(1500), minutes: 45 },
      { name: 'Wiring & Rewiring', slug: 'wiring-rewiring', base: inr(1499), min: inr(699), max: inr(20000), minutes: 180, certification: true },
      { name: 'Lighting Installation', slug: 'lighting-installation', base: inr(399), min: inr(249), max: inr(4000), minutes: 60 },
    ],
  },
  {
    name: 'Carpentry',
    slug: 'carpentry',
    icon: 'hammer',
    description: 'Furniture repair, door and window work, modular fittings.',
    base: inr(449), min: inr(249), max: inr(15000), minutes: 90,
    children: [
      { name: 'Furniture Repair', slug: 'furniture-repair', base: inr(399), min: inr(249), max: inr(5000), minutes: 75 },
      { name: 'Door & Lock Work', slug: 'door-lock-work', base: inr(349), min: inr(199), max: inr(4000), minutes: 60 },
      { name: 'Modular Kitchen & Wardrobe', slug: 'modular-kitchen-wardrobe', base: inr(1999), min: inr(999), max: inr(50000), minutes: 240, unit: 'quote_on_inspection' },
    ],
  },
  {
    name: 'AC Repair & Service',
    slug: 'ac-repair-service',
    icon: 'wind',
    description: 'Servicing, gas refill, installation and uninstallation of air conditioners.',
    base: inr(599), min: inr(399), max: inr(8000), minutes: 75,
    certification: true,
    children: [
      { name: 'AC Servicing', slug: 'ac-servicing', base: inr(599), min: inr(399), max: inr(1500), minutes: 60 },
      { name: 'AC Gas Refill', slug: 'ac-gas-refill', base: inr(2499), min: inr(1499), max: inr(6000), minutes: 90, certification: true },
      { name: 'AC Installation', slug: 'ac-installation', base: inr(1499), min: inr(899), max: inr(5000), minutes: 120, certification: true },
    ],
  },
  {
    name: 'Appliance Repair',
    slug: 'appliance-repair',
    icon: 'settings',
    description: 'Washing machine, refrigerator, microwave and geyser repair.',
    base: inr(499), min: inr(299), max: inr(9000), minutes: 75,
    children: [
      { name: 'Washing Machine Repair', slug: 'washing-machine-repair', base: inr(499), min: inr(299), max: inr(4000), minutes: 75 },
      { name: 'Refrigerator Repair', slug: 'refrigerator-repair', base: inr(599), min: inr(349), max: inr(6000), minutes: 90 },
      { name: 'Geyser Repair', slug: 'geyser-repair', base: inr(449), min: inr(249), max: inr(3500), minutes: 60 },
    ],
  },
 
];

export default categories;
