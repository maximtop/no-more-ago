# Local builds never upload, submit, or publish. See DEVELOPMENT.md for outputs.
.DEFAULT_GOAL := build
override BROWSERS := chrome edge firefox
override BROWSER_GOALS := $(filter $(BROWSERS),$(MAKECMDGOALS))
override BUILD_GOALS := $(filter build dev start release package,$(MAKECMDGOALS))
override COMMAND_GOALS := install setup init build dev start release package lint typecheck test check validate chrome_status chrome_update chrome_publish .require-chrome-app-id
override UNKNOWN_GOALS := $(filter-out $(COMMAND_GOALS) $(BROWSERS),$(MAKECMDGOALS))
ifneq ($(UNKNOWN_GOALS),)
  $(error Unknown command or unsupported browser: $(UNKNOWN_GOALS). Supported browsers: $(BROWSERS))
endif
ifneq ($(word 2,$(BROWSER_GOALS)),)
  $(error Choose at most one browser: $(BROWSERS))
endif
ifneq ($(BROWSER_GOALS),)
  ifneq ($(words $(BUILD_GOALS)),1)
    $(error A browser requires exactly one build command: build, dev, start, release or package)
  endif
endif
override BROWSER_TARGET := $(firstword $(BROWSER_GOALS))

.PHONY: $(COMMAND_GOALS) $(BROWSERS)

install setup init:
	pnpm install

build dev:
	pnpm build $(BROWSER_TARGET)

start:
	pnpm start $(BROWSER_TARGET)

release package:
	pnpm release $(BROWSER_TARGET)

lint:
	pnpm lint

typecheck:
	pnpm typecheck

test:
	pnpm test

check validate:
	pnpm check

$(BROWSERS):
	@:

# Local Chrome Web Store fallback. go-webext loads the credentials from the
# gitignored .env itself; make reads only the item ID from that file, accepting
# an optional export prefix, whitespace, quotes, and a trailing comment.
override CHROME_API_VERSION := v2
export CHROME_API_VERSION
ifneq ($(filter chrome_status chrome_update chrome_publish,$(MAKECMDGOALS)),)
  # An exported CHROME_APP_ID (for example from op run --env-file=.env.1password)
  # wins over the .env file.
  ifeq ($(origin CHROME_APP_ID),undefined)
    override CHROME_APP_ID := $(strip $(shell \
      sed -nE 's/^[[:space:]]*(export[[:space:]]+)?CHROME_APP_ID[[:space:]]*=[[:space:]]*//p' \
        .env 2>/dev/null \
      | tail -n 1 \
      | sed -E 's/[[:space:]]+\#.*$$//' \
      | tr -d "\"'\r"))
  endif
  ifeq ($(CHROME_APP_ID),)
    $(error CHROME_APP_ID is empty; export it or fill in .env (see .env.example))
  endif
endif

chrome_status:
	@go-webext status chrome -a "$(CHROME_APP_ID)"

# A fresh build guarantees that the uploaded manifest carries the package.json
# version.
chrome_update:
	@pnpm release chrome
	@go-webext update chrome -a "$(CHROME_APP_ID)" -f "dist/release/chrome.zip"

chrome_publish:
	@go-webext publish chrome -a "$(CHROME_APP_ID)" --staged
