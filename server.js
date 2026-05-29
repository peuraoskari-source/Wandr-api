const express  = require('express')
const cors     = require('cors')
const { getTågAvgångar } = require('./trafikverket')
require('dotenv').config()

const { savePrice, getMedian, getAllDeals } = require('./database')

const app  = express()
const PORT = process.env.PORT || 3000

app.use(cors())
app.use(express.json())


// ── ENDPOINTS ──────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '2.0.0', app: 'Wandr API' })
})

// Alla deals — sorterade efter störst rabatt vs median
app.get('/deals', (req, res) => {
  const deals = getAllDeals().map(enrichDeal)
  res.json({ deals, count: deals.length })
})

// Superdeals — minst 50% under median
app.get('/deals/super', (req, res) => {
  const deals = getAllDeals().map(enrichDeal).filter(d => d.pctUnderMedian >= 50)
  res.json({ deals, count: deals.length })
})

// Deals från specifik flygplats
app.get('/deals/from/:airport', (req, res) => {
  const airport = req.params.airport.toUpperCase()
  const deals = getAllDeals().map(enrichDeal).filter(d => d.airport === airport)
  res.json({ airport, deals, count: deals.length })
})

// Hämta riktiga tågavgångar från Trafikverket
app.get('/tag/:fran/:till', async (req, res) => {
  const fran = decodeURIComponent(req.params.fran)
  const till = decodeURIComponent(req.params.till)
  const avgångar = await getTågAvgångar(fran, till)

  // Spara varje avgång i databasen
  avgångar.forEach(t => {
    savePrice({
      from:    t.från,
      airport: t.från,
      dest:    t.till,
      type:    'train',
      price:   t.pris,
      stops:   0,
      dep:     t.avgång,
      dur:     '',
      seats:   ''
    })
  })

  // Berika med mediandata från databasen
  const berikade = avgångar.map(t => {
    const stats = getMedian(t.från, t.till, 'train')
    const pctUnderMedian = stats.median > 0
      ? Math.round((1 - t.pris / stats.median) * 100)
      : 0
    return { ...t, ...stats, pctUnderMedian, isSuper: pctUnderMedian >= 50 }
  })

  res.json({ från: fran, till: till, avgångar: berikade, count: berikade.length })
})

// Spara nytt pris (används senare av datainsamlaren)
app.post('/prices', (req, res) => {
  try {
    const routeId = savePrice(req.body)
    const stats   = getMedian(req.body.from, req.body.dest, req.body.type)
    res.json({ success: true, routeId, stats })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

// Lägg till hur många % under/över median ett pris är
function enrichDeal(d) {
  const pct = d.median > 0 ? Math.round((1 - d.price / d.median) * 100) : 0
  return { ...d, pctUnderMedian: pct, isSuper: pct >= 50 }
}

// ── AUTOMATISK DATAINSAMLING ──────────────────────────────────────────────
// Namnkarta — kod till stadsnamn
const STATIONSNAMN = {
  'Cst': 'Stockholm',
  'G':   'Göteborg',
  'M':   'Malmö',
  'Lu':  'Lund',
  'U':   'Uppsala',
  'Vå':  'Västerås',
  'Ör':  'Örebro',
  'Lp':  'Linköping',
  'Nr':  'Norrköping',
  'Söu': 'Sundsvall',
  'Uå':  'Umeå',
  'Åre': 'Åre',
}

const STRÄCKOR = [
  { från: 'Cst', till: 'G'   },
  { från: 'Cst', till: 'M'   },
  { från: 'Cst', till: 'Lu'  },
  { från: 'Cst', till: 'U'   },
  { från: 'Cst', till: 'Nr'  },
  { från: 'Cst', till: 'Lp'  },
  { från: 'Cst', till: 'Söu' },
  { från: 'Cst', till: 'Uå'  },
  { från: 'G',   till: 'Cst' },
  { från: 'G',   till: 'M'   },
  { från: 'G',   till: 'Lp'  },
  { från: 'M',   till: 'Cst' },
  { från: 'M',   till: 'G'   },
  { från: 'M',   till: 'Lu'  },
  { från: 'Lu',  till: 'Cst' },
  { från: 'Lu',  till: 'G'   },
  { från: 'Nr',  till: 'Cst' },
  { från: 'Lp',  till: 'Cst' },
  { från: 'U',   till: 'Cst' },
  { från: 'Uå',  till: 'Söu' },
]

async function samlaData() {
  console.log(`[${new Date().toLocaleTimeString('sv-SE')}] Hämtar avgångar för ${STRÄCKOR.length} sträckor...`)
  let totalt = 0

  for (const s of STRÄCKOR) {
    try {
      const avgångar = await getTågAvgångar(s.från, s.till)
      avgångar.forEach(t => {
        savePrice({
          from:    STATIONSNAMN[t.från] || t.från,
          airport: t.från,
          dest:    STATIONSNAMN[t.till] || t.till,
          type:    'train',
          price:   t.pris,
          stops:   0,
          dep:     t.avgång,
          dur:     '',
          seats:   ''
        })
      })
      totalt += avgångar.length
      await new Promise(r => setTimeout(r, 500))
    } catch(e) {
      console.error(`Fel för ${s.från}→${s.till}:`, e.message)
    }
  }

  console.log(`[${new Date().toLocaleTimeString('sv-SE')}] Sparade ${totalt} avgångar`)
}

// Kör direkt vid uppstart, sedan var 30:e minut
samlaData()
setInterval(samlaData, 30 * 60 * 1000)

// ── START ──────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Wandr API körs på http://localhost:${PORT}`)
  console.log(`Databas: wandr.db`)
})