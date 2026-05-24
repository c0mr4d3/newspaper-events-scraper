# Local Newspaper Event Lead Extractor

This project turns local Hindi epaper pages into a simple business lead database.

It is built for businesses that sell trophies, mementos, awards, plaques, souvenirs, certificates, shawls, and corporate gifts.

The core idea:

> Local newspapers report events.  
> Events often need awards and mementos.  
> Events often repeat every year.  
> So old newspaper event data can become future sales leads.

---

## What It Does

The system processes downloaded Dainik Bhaskar epaper pages and extracts event-related leads.

Final output:

```csv
city,date,org_name,event_topic
```

Example:

```csv
Raipur,2026-05-13,अग्रवाल समाज,प्रतिभा सम्मान समारोह
Raipur,2026-05-13,कृष्णा पब्लिक स्कूल,वार्षिकोत्सव एवं पुरस्कार वितरण
Raipur,2026-05-13,भारतीय स्टेट बैंक,उत्कृष्ट कर्मचारियों का सम्मान
Raipur,2026-05-13,XYZ TMT,डीलर मीट और पुरस्कार वितरण
```

---

## Why This Is Useful

Instead of finding random organisations, this finds organisations that have already conducted events.

Useful event types include:

- Award ceremonies
- Felicitation programs
- School/college annual functions
- Prize distributions
- Dealer meets
- Employee recognition events
- Foundation days
- Sports competitions
- Community/samaj events
- Government or PSU events

These can become future leads for mementos, trophies, and gifting products.

---

## How It Works

1. Download epaper pages for selected cities and dates.
2. OCR/read the Hindi newspaper pages.
3. Look for event-related news items.
4. Extract only the useful details.
5. Save everything into a simple CSV.

---

## Output Format

The output file is:

```text
event_leads.csv
```

Columns:

```csv
city,date,org_name,event_topic
```

Example table:

| city | date | org_name | event_topic |
|---|---|---|---|
| Raipur | 2026-05-13 | अग्रवाल समाज | प्रतिभा सम्मान समारोह |
| Raipur | 2026-05-13 | कृष्णा पब्लिक स्कूल | वार्षिकोत्सव एवं पुरस्कार वितरण |
| Raipur | 2026-05-13 | भारतीय स्टेट बैंक | उत्कृष्ट कर्मचारियों का सम्मान |

---

## What It Looks For

Hindi event keywords such as:

```text
कार्यक्रम
आयोजन
समारोह
सम्मान
पुरस्कार
वार्षिकोत्सव
स्थापना दिवस
प्रतिभा सम्मान
पुरस्कार वितरण
ट्रॉफी
शील्ड
स्मृति चिन्ह
प्रशस्ति पत्र
```

Organisation clues such as:

```text
स्कूल
कॉलेज
बैंक
संस्था
समाज
संघ
क्लब
ट्रस्ट
कंपनी
उद्योग
विभाग
चेंबर
एसोसिएशन
```

---

## What It Ignores

The system generally ignores:

- Crime reports
- Accidents
- Political allegations
- Protests
- Routine civic complaints
- Police/court cases
- Weather reports
- News with no event or award angle

---

## Current Scope

This is an MVP.

Current focus:

```text
Downloaded epaper pages → OCR → Event rows → CSV
```

No CRM.  
No lead scoring.  
No contact discovery.  
No automatic outreach.  
No complex deduplication.

Manual review is expected after extraction.

---

## Intended Use

After generating the CSV:

1. Review and clean the leads.
2. Identify strong event opportunities.
3. Find organisation contact details.
4. Approach them before their next likely event cycle.
5. Pitch trophies, mementos, awards, plaques, or custom gifts.

---

## Example Business Use

If a school had a prize distribution event in August last year, it may conduct a similar event again this year.

If a company held a dealer meet in September, it may need trophies, plaques, or mementos again around the same period.

If a samaj or association organised a talent felicitation ceremony, they may require customised awards or gifts for the next edition of the event.

The extracted database helps identify these opportunities early.

---


```text
Convert local Hindi epaper pages into a simple event lead database.
```
