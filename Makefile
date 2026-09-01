# Command-line values cannot override these selectors or reach a shell recipe.
override FIXED_MODES := dev release
override FIXED_BROWSERS := chrome firefox edge
override FIXED_STORE := chrome_status chrome_update chrome_publish
override GOALS := $(MAKECMDGOALS)
override MODE_GOALS := $(filter $(FIXED_MODES),$(GOALS))
override BROWSER_GOALS := $(filter $(FIXED_BROWSERS),$(GOALS))
override STORE_GOALS := $(filter $(FIXED_STORE),$(GOALS))
override OTHER_GOALS := $(filter-out $(FIXED_MODES) $(FIXED_BROWSERS) $(FIXED_STORE),$(GOALS))

ifneq ($(OTHER_GOALS),)
  $(error Usage: make [dev|release] [chrome|firefox|edge] or make chrome_status|chrome_update|chrome_publish)
endif
ifeq ($(words $(MODE_GOALS)),0)
  ifneq ($(BROWSER_GOALS),)
    $(error A browser requires exactly one mode: make dev|release [chrome|firefox|edge])
  endif
else ifneq ($(words $(MODE_GOALS)),1)
  $(error Choose exactly one mode: dev or release)
endif
ifneq ($(words $(BROWSER_GOALS)),0)
  ifneq ($(words $(BROWSER_GOALS)),1)
    $(error Choose at most one browser: chrome, firefox, or edge)
  endif
endif

override SELECTED_BROWSER := $(firstword $(BROWSER_GOALS))
override SELECTED_ARGS := $(if $(SELECTED_BROWSER),$(SELECTED_BROWSER),)

# Local Chrome Web Store fallback. go-webext loads the credentials from the
# gitignored .env itself; make reads only the item ID from that file.
override CHROME_ZIP := dist/release/chrome.zip
export CHROME_API_VERSION := v2
ifneq ($(STORE_GOALS),)
  override CHROME_APP_ID := $(strip $(shell sed -n 's/^CHROME_APP_ID=//p' .env 2>/dev/null | tr -d '"\r'))
  ifeq ($(CHROME_APP_ID),)
    $(error CHROME_APP_ID is empty; fill in .env (see .env.example))
  endif
endif

.DEFAULT_GOAL := dev
.PHONY: dev release chrome firefox edge chrome_status chrome_update chrome_publish

dev:
	@pnpm dev $(SELECTED_ARGS)

release:
	@pnpm release $(SELECTED_ARGS)

chrome firefox edge:
	@:

chrome_status:
	@go-webext status chrome -a "$(CHROME_APP_ID)"

chrome_update:
	@test -f "$(CHROME_ZIP)" || { echo "$(CHROME_ZIP) is missing; run pnpm release chrome first" >&2; exit 1; }
	@unzip -p "$(CHROME_ZIP)" manifest.json | node -e 'const zip = JSON.parse(require("fs").readFileSync(0, "utf8")).version; const pkg = require("./package.json").version; if (zip !== pkg) { console.error("$(CHROME_ZIP) manifest version " + zip + " does not match package.json version " + pkg); process.exit(1); }'
	@go-webext update chrome -a "$(CHROME_APP_ID)" -f "$(CHROME_ZIP)"

chrome_publish:
	@go-webext publish chrome -a "$(CHROME_APP_ID)" --staged
