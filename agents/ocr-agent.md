# OCR Agent

Role: OCR downloaded newspaper page images.

Input:
- `downloads/{slug}/{date}/*.jpeg`

Output:
- `ocr/{slug}/{date}/*.txt`

Rules:
- Use Hindi + English OCR.
- Cache OCR output and skip existing text unless `--force`.
- Do not extract leads manually.
- Do not modify downloaded images.
