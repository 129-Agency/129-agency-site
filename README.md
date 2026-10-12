# 129 Agency — site (proposition B)

Static site, no build step. Deploy as-is (Vercel: framework "Other", output = root).

- `index.html` — whole site (CSS + JS inline)
- `img/` — covers and partner logos

To plug in:
- **Live campaigns**: replace the `LIVE` array with a call to a server route reading the Meta Marketing API (Insights). Token stays server-side.
- **Book a call**: paste the Lemcal embed inside `#lemcal-embed`. Bookings → Airtable via Lemcal webhook (or Make/Zapier).
