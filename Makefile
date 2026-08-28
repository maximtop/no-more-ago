# Command-line values cannot override these selectors or reach a shell recipe.
override FIXED_MODES := dev release
override FIXED_BROWSERS := chrome firefox edge
override GOALS := $(MAKECMDGOALS)
override MODE_GOALS := $(filter $(FIXED_MODES),$(GOALS))
override BROWSER_GOALS := $(filter $(FIXED_BROWSERS),$(GOALS))
override OTHER_GOALS := $(filter-out $(FIXED_MODES) $(FIXED_BROWSERS),$(GOALS))

ifeq ($(GOALS),)
  override SELECTED_MODE := dev
else
  ifneq ($(OTHER_GOALS),)
    $(error Usage: make [dev|release] [chrome|firefox|edge])
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
  override SELECTED_MODE := $(firstword $(MODE_GOALS))
endif

override SELECTED_BROWSER := $(firstword $(BROWSER_GOALS))
override SELECTED_ARGS := $(if $(SELECTED_BROWSER),$(SELECTED_BROWSER),)

.DEFAULT_GOAL := dev
.PHONY: dev release chrome firefox edge

dev:
	@pnpm dev $(SELECTED_ARGS)

release:
	@pnpm release $(SELECTED_ARGS)

chrome firefox edge:
	@:
