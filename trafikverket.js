const fetch = require('node-fetch')
require('dotenv').config()

const API_URL = 'https://api.trafikinfo.trafikverket.se/v2/data.json'
const API_KEY = process.env.TRAFIKVERKET_API_KEY

// Simulera ett pris baserat på sträcka och operatör
function simuleraPris(från, till, operatör) {
  const sträckor = {
    'Cst-G':   { bas: 350, variation: 200 },
    'Cst-M':   { bas: 280, variation: 150 },
    'G-M':     { bas: 180, variation: 100 },
    'Cst-Lu':  { bas: 900, variation: 400 },
  }
  const nyckel = `${från}-${till}`
  const s = sträckor[nyckel] || { bas: 500, variation: 300 }
  return Math.round(s.bas + (Math.random() * s.variation))
}

async function getTågAvgångar(från, till) {
  const body = `
    <REQUEST>
      <LOGIN authenticationkey="${API_KEY}" />
      <QUERY objecttype="TrainAnnouncement" schemaversion="1.9" limit="10">
        <FILTER>
          <AND>
            <EQ name="FromLocation.LocationName" value="${från}" />
            <EQ name="ToLocation.LocationName" value="${till}" />
            <GT name="AdvertisedTimeAtLocation" value="$now" />
          </AND>
        </FILTER>
        <INCLUDE>AdvertisedTimeAtLocation</INCLUDE>
        <INCLUDE>FromLocation</INCLUDE>
        <INCLUDE>ToLocation</INCLUDE>
        <INCLUDE>ProductInformation</INCLUDE>
        <INCLUDE>TrainOwner</INCLUDE>
      </QUERY>
    </REQUEST>
  `

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/xml' },
      body
    })
    const data = await res.json()
    const tåg = data?.RESPONSE?.RESULT?.[0]?.TrainAnnouncement || []

    return tåg.map(t => {
      const avgångsTid = t.AdvertisedTimeAtLocation
      const pris = simuleraPris(från, till, t.TrainOwner)

      return {
        från:     t.FromLocation?.[0]?.LocationName,
        till:     t.ToLocation?.[0]?.LocationName,
        avgång:   avgångsTid,
        operatör: t.TrainOwner,
        pris,
        typ:      'train'
      }
    })
  } catch (e) {
    console.error('Trafikverket fel:', e.message)
    return []
  }
}

module.exports = { getTågAvgångar }