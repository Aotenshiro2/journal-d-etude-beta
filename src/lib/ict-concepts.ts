import { ICTConcepts } from '@/types'

export const ICT_TRADING_CONCEPTS: ICTConcepts = {
  // ===== STRUCTURE & CASSURES =====
  'Order Block': {
    category: 'Structure & Cassures',
    definition: 'Dernière bougie haussière/baissière avant un déplacement impulsif qui sert de zone d\'origine d\'ordres.',
    keywords: ['order block', 'OB', 'zone d\'ordre', 'bloc d\'ordre'],
    weight: 3
  },
  'Breaker': {
    category: 'Structure & Cassures',
    definition: 'Ancien OB invalidé qui devient zone d\'intérêt inverse.',
    keywords: ['breaker', 'breaker block', 'retournement d\'OB'],
    weight: 3
  },
  'Break of Structure': {
    category: 'Structure & Cassures',
    definition: 'Cassure d\'un swing clé dans le sens de la tendance.',
    keywords: ['BOS', 'break of structure', 'cassure structurelle'],
    weight: 3
  },
  'Change of Character': {
    category: 'Structure & Cassures',
    definition: 'Premier signe de renversement local (précurseur).',
    keywords: ['CHOCH', 'change of character', 'changement de caractère'],
    weight: 3
  },
  'Market Structure Shift': {
    category: 'Structure & Cassures',
    definition: 'Rupture de structure notable (changement de biais).',
    keywords: ['MSS', 'BOS fort', 'shift'],
    weight: 3
  },
  'Displacement': {
    category: 'Structure & Cassures',
    definition: 'Mouvement impulsif net cassant structure et créant FVG.',
    keywords: ['displacement', 'impulsion', 'expansion'],
    weight: 3
  },
  'Swing High/Low': {
    category: 'Structure & Cassures',
    definition: 'Pivot structurel.',
    keywords: ['swing high', 'swing low', 'pivot structurel'],
    weight: 2
  },
  'Reaccumulation/Redistribution': {
    category: 'Structure & Cassures',
    definition: 'Consolidations dans tendance.',
    keywords: ['reaccumulation', 'redistribution', 'consolidations'],
    weight: 2
  },

  // ===== LIQUIDITÉ =====
  'Liquidity': {
    category: 'Liquidité',
    definition: 'Ordres en attente (stops/pendings) autour de hauts/bas, equal highs/lows, etc.',
    keywords: ['liquidity', 'LQ', 'liquidité', 'pools'],
    weight: 3
  },
  'Liquidity Grab': {
    category: 'Liquidité',
    definition: 'Chasse de stops ; balayage d\'un pool avant inversion.',
    keywords: ['liquidity grab', 'LG', 'stop hunt', 'sweep'],
    weight: 3
  },
  'Buy-side Liquidity': {
    category: 'Liquidité',
    definition: 'Liquidité au-dessus des sommets (stops vendeurs).',
    keywords: ['buy-side liquidity', 'BSL', 'liquidité acheteuse'],
    weight: 3
  },
  'Sell-side Liquidity': {
    category: 'Liquidité',
    definition: 'Liquidité sous les creux (stops acheteurs).',
    keywords: ['sell-side liquidity', 'SSL', 'liquidité vendeuse'],
    weight: 3
  },
  'Equal Highs/Lows': {
    category: 'Liquidité',
    definition: 'Sommets/creux égaux (piscines de stops).',
    keywords: ['equal highs', 'equal lows', 'EQH', 'EQL'],
    weight: 2
  },
  'Engineered Liquidity': {
    category: 'Liquidité',
    definition: 'Construction délibérée de pools avant expansion.',
    keywords: ['engineered liquidity', 'construction liquidité'],
    weight: 2
  },
  'Draw On Liquidity': {
    category: 'Liquidité',
    definition: 'Cible dominante de liquidité que le prix "attire".',
    keywords: ['draw on liquidity', 'DOL', 'cible liquidité'],
    weight: 2
  },

  // ===== INEFFICIENCES & ARRAYS =====
  'Fair Value Gap': {
    category: 'Inefficiences & Arrays',
    definition: 'Espace inefficiente entre bougies (déséquilibre) que le prix tend à combler.',
    keywords: ['fair value gap', 'FVG', 'imbalance', 'inefficiency'],
    weight: 3
  },
  'Mitigation Block': {
    category: 'Inefficiences & Arrays',
    definition: 'Zone où le prix revient "mitiger" (couvrir) l\'empreinte d\'ordres précédents.',
    keywords: ['mitigation block', 'MB', 'zone de mitigation'],
    weight: 3
  },
  'PD Array': {
    category: 'Inefficiences & Arrays',
    definition: '"Price Delivery arrays" (FVG, OB, MB…) guides de livraison du prix.',
    keywords: ['PD array', 'repères SMT', 'price delivery arrays'],
    weight: 2
  },
  'Premium Arrays': {
    category: 'Inefficiences & Arrays',
    definition: 'Zones d\'exécution préférentielles en premium.',
    keywords: ['premium arrays', 'zones premium'],
    weight: 2
  },
  'Discount Arrays': {
    category: 'Inefficiences & Arrays',
    definition: 'Zones d\'exécution préférentielles en discount.',
    keywords: ['discount arrays', 'zones discount'],
    weight: 2
  },
  'Repricing': {
    category: 'Inefficiences & Arrays',
    definition: 'Réajustement rapide vers zones d\'inefficiences.',
    keywords: ['repricing', 'réévaluation'],
    weight: 2
  },

  // ===== NIVEAUX & ZONES =====
  'Premium/Discount': {
    category: 'Niveaux & Zones',
    definition: 'Répartition au-dessus/dessous du mid d\'un range pour évaluer le prix "cher/pas cher".',
    keywords: ['premium', 'discount', 'premium/discount'],
    weight: 3
  },
  'Equilibrium': {
    category: 'Niveaux & Zones',
    definition: 'Milieu d\'un range (50%).',
    keywords: ['equilibrium', 'EQ', 'mid', '0.5'],
    weight: 2
  },
  'Range/Consolidation': {
    category: 'Niveaux & Zones',
    definition: 'Zone latérale délimitant EQ/Boundaries.',
    keywords: ['range', 'consolidation'],
    weight: 2
  },
  'High/Low of Day': {
    category: 'Niveaux & Zones',
    definition: 'Extrêmes journaliers.',
    keywords: ['HOD', 'LOD', 'high of day', 'low of day'],
    weight: 2
  },
  'Weekly/Monthly High/Low': {
    category: 'Niveaux & Zones',
    definition: 'Extrêmes HTF.',
    keywords: ['WH', 'WL', 'MH', 'ML', 'weekly high', 'monthly high'],
    weight: 2
  },

  // ===== SESSIONS & TIMING =====
  'Daily Bias/HTF Bias': {
    category: 'Sessions & Timing',
    definition: 'Biais issu d\'un TF supérieur (D1, H4).',
    keywords: ['daily bias', 'HTF bias', 'biais journalier', 'biais HTF'],
    weight: 3
  },
  'Session': {
    category: 'Sessions & Timing',
    definition: 'Fenêtres temporelles (London Open, New York Open, Asia).',
    keywords: ['session', 'LO', 'NYO', 'AS', 'sessions'],
    weight: 2
  },
  'Killzones': {
    category: 'Sessions & Timing',
    definition: 'Plages horaires à fort flux.',
    keywords: ['killzones', 'kill zones'],
    weight: 2
  },
  'Equities Open': {
    category: 'Sessions & Timing',
    definition: 'Ouverture actions US (impact sur flux).',
    keywords: ['equities open', 'NYSE open', 'open NYSE'],
    weight: 2
  },
  'IPDA': {
    category: 'Sessions & Timing',
    definition: 'Logique hypothétique de livraison institutionnelle.',
    keywords: ['IPDA', 'institutional price delivery algorithm'],
    weight: 1
  }
}

export function detectConcepts(text: string): string[] {
  const detectedConcepts: string[] = []
  const lowerText = text.toLowerCase()
  
  for (const [conceptName, conceptData] of Object.entries(ICT_TRADING_CONCEPTS)) {
    const hasKeyword = conceptData.keywords.some(keyword => 
      lowerText.includes(keyword.toLowerCase())
    )
    
    if (hasKeyword) {
      detectedConcepts.push(conceptName)
    }
  }
  
  return detectedConcepts
}