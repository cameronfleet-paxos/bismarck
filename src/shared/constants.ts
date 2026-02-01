import type { ThemeName, ThemeColors } from './types'

// Famous German figure icons for agents
// Mix of iconic historical figures and modern pop-culture personalities
export const agentIcons = [
  // Super iconic historical (very recognizable silhouettes)
  'einstein',    // Wild hair
  'beethoven',   // Wild hair, intense
  'marx',        // Big beard
  'bismarck',    // Pickelhaube helmet
  'bach',        // Baroque wig
  'mozart',      // Powdered wig (Austrian but German-speaking)
  'freud',       // Beard, cigar (Austrian but iconic)
  'nietzsche',   // Big mustache
  'luther',      // Monk's cap
  'goethe',      // Distinguished profile
  // Modern athletes
  'beckenbauer', // Soccer legend
  'klopp',       // Glasses, big smile
  'muller',      // Thomas Müller
  'neuer',       // Goalkeeper
  'schweinsteiger',
  'ballack',
  'matthaus',
  'rummenigge',
  // Musicians/Artists
  'kraftwerk',   // Robot/electronic aesthetic
  'rammstein',   // Industrial metal aesthetic
  'scorpions',   // Rock band
  'falco',       // 80s pop (Austrian)
  'nena',        // 99 Luftballons
  'tokiohotel',  // Bill Kaulitz spiky hair
  // Film/TV
  'fassbender',  // Michael Fassbender
  'schweiger',   // Til Schweiger
  'kruger',      // Diane Kruger
  'bruhl',       // Daniel Brühl
  'waltz',       // Christoph Waltz (Austrian)
  'hanna',       // Hanna Schygulla
  // Models/Fashion
  'klum',        // Heidi Klum
  'schiffer',    // Claudia Schiffer
  'bruni',       // Carla Bruni (Italian-French but iconic)
  'bundchen',    // Gisele (Brazilian-German)
  // Racing
  'schumacher',  // Michael Schumacher - helmet
  'vettel',      // Sebastian Vettel - helmet
  'rosberg',     // Nico Rosberg
  // Other modern
  'merkel',      // Angela Merkel - distinctive haircut
  'kinski',      // Klaus Kinski - wild eyes
  'herzog',      // Werner Herzog
  'wenders',     // Wim Wenders
  'beuys',       // Joseph Beuys - hat
  'lagerfeld',   // Karl Lagerfeld - glasses, ponytail
  'flick',       // Hansi Flick
  'hasselhoff',  // David Hasselhoff (American but huge in Germany)
  'dirk',        // Dirk Nowitzki
  'becker',      // Boris Becker
  'graf'         // Steffi Graf
] as const

export type AgentIconName = typeof agentIcons[number]

export const themes: Record<ThemeName, ThemeColors> = {
  brown: { bg: '#2a1e14', fg: '#ffffff' },
  blue: { bg: '#0f1433', fg: '#ffffff' },
  red: { bg: '#330f0f', fg: '#ffffff' },
  gray: { bg: '#222222', fg: '#ffffff' },
  green: { bg: '#0f2814', fg: '#ffffff' },
  purple: { bg: '#280f33', fg: '#ffffff' },
  teal: { bg: '#0f2828', fg: '#ffffff' },
  orange: { bg: '#332814', fg: '#ffffff' },
  pink: { bg: '#33141e', fg: '#ffffff' },
}
