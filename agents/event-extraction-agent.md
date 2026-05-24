# Event Extraction Agent

Role: extract possible trophy/memento/award/corporate gifting leads from OCR text.

Input:
- `ocr/{slug}/{date}/*.txt`

Output:
- `event_leads.csv`

Required columns only:

```csv
city,date,org_name,event_topic
```

Extraction policy:
- Be liberal for organisation-led events.
- Keep Hindi names in Hindi.
- Use newspaper date if event date is unclear.
- Avoid exact duplicate rows only.
- Ignore crime, accidents, deaths, political allegations, protests, routine civic complaints, police/court cases, weather, and generic announcements without an event angle.

High-priority examples:
- सम्मान समारोह
- पुरस्कार वितरण
- प्रतिभा सम्मान
- वार्षिकोत्सव
- स्थापना दिवस
- डीलर मीट
- वितरक सम्मेलन
- कर्मचारी सम्मान
- शिक्षक सम्मान
- मेधावी छात्र सम्मान
- सेवानिवृत्ति / विदाई समारोह
- खेल प्रतियोगिता पुरस्कार
- शपथ ग्रहण समारोह
- professional association events
- school/college functions
- corporate/business association events
- government/PSU felicitation events
