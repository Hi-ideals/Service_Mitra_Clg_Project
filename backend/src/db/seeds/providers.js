/**
 * Demo service providers, fully set up and approved, so discovery and booking
 * have something real to work against from Phase 6 onward.
 */
const inr = (rupees) => rupees * 100;

/** Monday to Saturday, 09:00-18:00. */
const WEEKDAYS = [1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
  dayOfWeek,
  startTime: '09:00',
  endTime: '18:00',
}));

export const demoProviders = [
  {
    fullName: 'Suresh Patil',
    email: 'plumber@servicesetu.in',
    phone: '9000000101',
    businessName: 'Patil Plumbing Works',
    headline: 'Plumbing repairs and bathroom fittings, 12 years in Bidar',
    bio: 'Handles leaks, tap replacement, drainage blockages and complete bathroom fitting. Same-day service for emergencies.',
    experienceYears: 12,
    languages: ['Kannada', 'Hindi', 'Marathi'],
    skills: ['Leak repair', 'Tap fitting', 'Drainage', 'Bathroom fitting'],
    services: [
      { slug: 'tap-mixer-repair', priceMinor: inr(299), visitChargeMinor: inr(50) },
      { slug: 'leak-seepage-fix', priceMinor: inr(599), visitChargeMinor: inr(50) },
      { slug: 'drain-cleaning', priceMinor: inr(699) },
    ],
    areas: [{ city: 'Bidar', state: 'Karnataka', pincodes: ['585401', '585402', '585403'], centerLat: 17.9104, centerLng: 77.5199, radiusKm: 15 }],
    availability: WEEKDAYS,
    rating: { average: 4.7, count: 128, completed: 142 },
  },
  {
    fullName: 'Imran Shaikh',
    email: 'electrician@servicesetu.in',
    phone: '9000000102',
    businessName: 'Shaikh Electricals',
    headline: 'Licensed electrician for wiring, fans and lighting',
    bio: 'Certified for domestic wiring and rewiring. Fan installation, switchboard repair, lighting and safety inspection.',
    experienceYears: 9,
    languages: ['Urdu', 'Hindi', 'Kannada'],
    skills: ['Wiring', 'Switchboard repair', 'Fan installation', 'Lighting'],
    services: [
      { slug: 'switch-socket-repair', priceMinor: inr(249) },
      { slug: 'fan-installation-repair', priceMinor: inr(349), visitChargeMinor: inr(50) },
      { slug: 'wiring-rewiring', priceMinor: inr(1799) },
      { slug: 'lighting-installation', priceMinor: inr(449) },
    ],
    areas: [{ city: 'Bidar', state: 'Karnataka', pincodes: ['585401', '585402'], centerLat: 17.9133, centerLng: 77.5301, radiusKm: 12 }],
    availability: WEEKDAYS,
    rating: { average: 4.5, count: 86, completed: 97 },
  },
  {
    fullName: 'Mahesh Rao',
    email: 'acrepair@servicesetu.in',
    phone: '9000000103',
    businessName: 'CoolCare AC Services',
    headline: 'AC servicing, gas refill and installation',
    bio: 'Authorised technician for split and window AC units. Servicing, gas top-up, installation and uninstallation.',
    experienceYears: 7,
    languages: ['Kannada', 'Telugu', 'Hindi'],
    skills: ['AC servicing', 'Gas refill', 'AC installation', 'Compressor repair'],
    services: [
      { slug: 'ac-servicing', priceMinor: inr(649) },
      { slug: 'ac-gas-refill', priceMinor: inr(2699) },
      { slug: 'ac-installation', priceMinor: inr(1699) },
    ],
    areas: [{ city: 'Bidar', state: 'Karnataka', pincodes: ['585401', '585403', '585404'], centerLat: 17.9052, centerLng: 77.5148, radiusKm: 20 }],
    availability: WEEKDAYS,
    rating: { average: 4.8, count: 203, completed: 219 },
  },
  {
    fullName: 'Anil Kumbar',
    email: 'carpenter@servicesetu.in',
    phone: '9000000104',
    businessName: 'Kumbar Woodworks',
    headline: 'Furniture repair, doors and modular fittings',
    bio: 'Custom woodwork, furniture repair, door and lock fitting, modular kitchen and wardrobe installation.',
    experienceYears: 15,
    languages: ['Kannada', 'Hindi'],
    skills: ['Furniture repair', 'Door fitting', 'Modular kitchen', 'Wardrobe'],
    services: [
      { slug: 'furniture-repair', priceMinor: inr(449) },
      { slug: 'door-lock-work', priceMinor: inr(399) },
    ],
    areas: [{ city: 'Bidar', state: 'Karnataka', pincodes: ['585401'], centerLat: 17.9201, centerLng: 77.5255, radiusKm: 10 }],
    availability: WEEKDAYS.slice(0, 5),
    rating: { average: 4.3, count: 41, completed: 48 },
  },
];

export default demoProviders;
