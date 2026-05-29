    const express  = require('express')
    const cors     = require('cors')
    const { getTågAvgångar } = require('./trafikverket')
    const { getFlyg } = require('./flyg')
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

        const FLYGRUTTER = [
    { från: 'ARN', till: 'LHR' }, // Stockholm → London
    { från: 'ARN', till: 'AMS' }, // Stockholm → Amsterdam
    { från: 'ARN', till: 'BCN' }, // Stockholm → Barcelona
    { från: 'ARN', till: 'CDG' }, // Stockholm → Paris
    { från: 'ARN', till: 'BER' }, // Stockholm → Berlin
    { från: 'GOT', till: 'LHR' }, // Göteborg → London
    { från: 'GOT', till: 'AMS' }, // Göteborg → Amsterdam
    { från: 'MMX', till: 'BCN' }, // Malmö → Barcelona
    { från: 'ARN', till: 'JFK' }, // Stockholm → New York
    { från: 'ARN', till: 'DXB' }, // Stockholm → Dubai
    ]

    const FLYGPLATSER = {
    'ARN': 'Stockholm',
    'GOT': 'Göteborg',
    'MMX': 'Malmö',
    'LHR': 'London',
    'AMS': 'Amsterdam',
    'BCN': 'Barcelona',
    'CDG': 'Paris',
    'BER': 'Berlin',
    'JFK': 'New York',
    'DXB': 'Dubai',
    'CPH': 'Köpenhamn',
    }

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
    // Hämta flygavgångar
  for (const r of FLYGRUTTER) {
    try {
      const flyg = await getFlyg(r.från, r.till)
      flyg.forEach(f => {
        savePrice({
          from:    FLYGPLATSER[f.från] || f.från,
          airport: f.från,
          dest:    FLYGPLATSER[f.till] || f.till,
          type:    'fly',
          price:   simuleraPris(f.från, f.till),
          stops:   0,
          dep:     f.avgång,
          dur:     '',
          seats:   ''
        })
      })
      totalt += flyg.length
      await new Promise(r => setTimeout(r, 500))
    } catch(e) {
      console.error(`Flyg-fel ${r.från}→${r.till}:`, e.message)
    }
  }
    console.log(`[${new Date().toLocaleTimeString('sv-SE')}] Sparade ${totalt} avgångar`)
    }
    function simuleraPris(från, till) {
  const priser = {
    'ARN-LHR': { bas: 800,  variation: 600  },
    'ARN-AMS': { bas: 600,  variation: 400  },
    'ARN-BCN': { bas: 700,  variation: 500  },
    'ARN-CDG': { bas: 750,  variation: 500  },
    'ARN-BER': { bas: 500,  variation: 400  },
    'GOT-LHR': { bas: 700,  variation: 500  },
    'GOT-AMS': { bas: 500,  variation: 300  },
    'MMX-BCN': { bas: 600,  variation: 400  },
    'ARN-JFK': { bas: 3500, variation: 2000 },
    'ARN-DXB': { bas: 2000, variation: 1500 },
  }
  const nyckel = `${från}-${till}`
  const s = priser[nyckel] || { bas: 1000, variation: 500 }
  return Math.round(s.bas + (Math.random() * s.variation))
}
    // Kör direkt vid uppstart, sedan var 30:e minut
    samlaData()
    setInterval(samlaData, 30 * 60 * 1000)

    // ── START ──────────────────────────────────────────────────────────────────

    app.listen(PORT, () => {
    console.log(`Wandr API körs på http://localhost:${PORT}`)
    console.log(`Databas: wandr.db`)
    })