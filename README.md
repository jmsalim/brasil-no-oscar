# brasil-no-oscar
Brazil's submissions to the Academy Award for Best International Feature Film, 1960 to 2026. ENG 6806 class project.

## The timeline page

`index.html` is a static page (plain HTML, CSS and JavaScript, no build step) that puts every submission on one timeline:

- **Result row**: each year's film, marked as won, nominated, shortlisted, not nominated, disqualified or pending. Nominations and the win are labelled. Shaded columns run through the whole chart for the years Brazil sent nothing.
- **Movement and setting lanes**: from Claude's tags. Square marks show confidence: solid for high, half-tone for medium, outline for low. A selector hides lower-confidence tags.
- **Returning directors**: one lane per director with two or more submissions.
- **Theme highlight**: pick a theme to fade every film without it.
- Click a film (or tab to it and press Enter) to open its record, with the Wikipedia facts and Claude's tags shown separately, each tag with its source and confidence. A movements-by-decade table and a full table view sit below the chart.

### Data

- `brazil_oscar_submissions.json`: built from the [Wikipedia list](https://en.wikipedia.org/wiki/List_of_Brazilian_submissions_for_the_Academy_Award_for_Best_International_Feature_Film).
- `brazil_oscar_tags.json`: movement, setting and theme tags from Claude's general knowledge, **not verified against a source**, each with a confidence level.

### Run it locally

The page loads the JSON files with `fetch`, so open it through a local server rather than straight from disk:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

### Publish with GitHub Pages

In the repository's **Settings → Pages**, set the source to *Deploy from a branch*, pick `main` and `/ (root)`. The `.nojekyll` file makes Pages serve the files as they are.
