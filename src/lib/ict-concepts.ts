import { ICTConcepts } from '@/types'

export const ICT_TRADING_CONCEPTS: ICTConcepts = {
  'Order Block': {
    category: 'Smart Money Concepts',
    keywords: ['order block', 'OB', 'institutional order', 'smart money'],
    weight: 3
  },
  'Fair Value Gap': {
    category: 'Price Action',
    keywords: ['fair value gap', 'FVG', 'imbalance', 'gap'],
    weight: 3
  },
  'Liquidity': {
    category: 'Market Structure',
    keywords: ['liquidity', 'stops', 'equal highs', 'equal lows', 'BSL', 'SSL'],
    weight: 3
  },
  'Break of Structure': {
    category: 'Market Structure',
    keywords: ['BOS', 'break of structure', 'structural break'],
    weight: 3
  },
  'Change of Character': {
    category: 'Market Structure',
    keywords: ['CHoCH', 'change of character', 'trend change'],
    weight: 3
  },
  'Inducement': {
    category: 'Smart Money Concepts',
    keywords: ['inducement', 'trap', 'fake breakout', 'stop hunt'],
    weight: 2
  },
  'Displacement': {
    category: 'Price Action',
    keywords: ['displacement', 'strong move', 'impulse'],
    weight: 2
  },
  'Mitigation': {
    category: 'Price Action',
    keywords: ['mitigation', 'retest', 'back test'],
    weight: 2
  },
  'Premium': {
    category: 'Price Action',
    keywords: ['premium', 'high', 'upper half', 'sell zone'],
    weight: 1
  },
  'Discount': {
    category: 'Price Action',
    keywords: ['discount', 'low', 'lower half', 'buy zone'],
    weight: 1
  },
  'Fibonacci': {
    category: 'Technical Analysis',
    keywords: ['fibonacci', 'fib', '61.8', '78.6', 'optimal trade entry'],
    weight: 2
  },
  'Sweep': {
    category: 'Market Structure',
    keywords: ['sweep', 'liquidity grab', 'stop loss hunt'],
    weight: 2
  },
  'Relative Equal Highs': {
    category: 'Market Structure',
    keywords: ['REH', 'relative equal highs', 'resistance level'],
    weight: 2
  },
  'Relative Equal Lows': {
    category: 'Market Structure',
    keywords: ['REL', 'relative equal lows', 'support level'],
    weight: 2
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