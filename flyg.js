const fetch = require('node-fetch')
require('dotenv').config()

const API_KEY = process.env.AVIATIONSTACK_API_KEY

async function getFlyg(från, till) {
  try {
    const url = `http://api.aviationstack.com/v1/flights?access_key=${API_KEY}&dep_iata=${från}&arr_iata=${till}&flight_status=scheduled&limit=10`
    const res  = await fetch(url)
    const data = await res.json()

    if (!data.data) {
      console.error('Aviation Stack fel:', data.error || data)
      return []
    }

    return data.data.map(f => ({
      från:     f.departure?.iata,
      till:     f.arrival?.iata,
      avgång:   f.departure?.scheduled,
      ankomst:  f.arrival?.scheduled,
      flygbolag: f.airline?.name,
      flygnr:   f.flight?.iata,
      typ:      'fly'
    }))
  } catch(e) {
    console.error('Flyg-fel:', e.message)
    return []
  }
}

module.exports = { getFlyg }