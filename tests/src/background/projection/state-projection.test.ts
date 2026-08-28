/**
 * @file Verifies popup projection matches tab failures to the current hostname.
 */

import { describe, expect, it, vi } from "vitest";
import { ActivationManager } from "../../../../src/background/application/activation-manager";
import type { ActivationCoordinator } from "../../../../src/background/application/contracts";
import { APPLICATION_PHASE } from "../../../../src/background/application/contracts";
import type { ApplicationStateView } from "../../../../src/background/application/state";
import { StateProjection } from "../../../../src/background/projection/state-projection";
import type {
    ActivationReconcileResult,
} from "../../../../src/background/runtime/document-activation";
import {
    ACTIVATION_POLICY,
    RECONCILE_FAILURE_SCOPE,
    REGISTRATION_OUTCOME,
    TAB_ACTION,
} from "../../../../src/background/runtime/document-activation";
import {
    DOCUMENT_PHASE,
    DOCUMENT_STATUS_MESSAGE,
} from "../../../../src/shared/messaging/document-messages";
import {
    POPUP_STATUS,
    STATE_AVAILABILITY,
} from "../../../../src/shared/messaging/view-state-values";
import { DEFAULT_SETTINGS_SNAPSHOT } from "../../../../src/shared/settings/snapshot";
import type { TabsRuntime } from "../../../../src/background/runtime/tabs";

describe("StateProjection", () => {
    it("does not apply a stale failure after a tab navigates", async () => {
        const result: ActivationReconcileResult = {
            revision: 1,
            policy: ACTIVATION_POLICY.ENABLED,
            failures: [{
                scope: RECONCILE_FAILURE_SCOPE.TAB,
                tabId: 1,
                hostname: "a.test",
                action: TAB_ACTION.INJECT,
            }],
            registration: REGISTRATION_OUTCOME.UNCHANGED,
            tabs: [{
                tabId: 1,
                hostname: "a.test",
                action: TAB_ACTION.INJECT,
                ok: false,
            }],
        };
        const coordinator: ActivationCoordinator = {
            reconcile: vi.fn(() => Promise.resolve(result)),
        };
        const activation = new ActivationManager(coordinator);
        await activation.reconcile(
            ACTIVATION_POLICY.ENABLED,
            1,
            {},
        );

        let tabUrl = "https://a.test/page";
        const tabs: TabsRuntime = {
            query: vi.fn(() => Promise.resolve([{ id: 1, url: tabUrl }])),
            getAllFrames: vi.fn(() => Promise.resolve([])),
            sendMessage: vi.fn(() => Promise.resolve({
                type: DOCUMENT_STATUS_MESSAGE,
                phase: DOCUMENT_PHASE.ACTIVE,
            })),
        };
        const projection = new StateProjection(tabs, activation);
        const state: ApplicationStateView = {
            phase: APPLICATION_PHASE.READY,
            snapshot: DEFAULT_SETTINGS_SNAPSHOT,
            failure: undefined,
        };

        const failed = await projection.derivePopup(state);
        tabUrl = "https://b.test/page";
        const navigated = await projection.derivePopup(state);

        expect(failed).toMatchObject({
            availability: STATE_AVAILABILITY.READY,
            status: POPUP_STATUS.RUNTIME_FAILED,
        });
        expect(navigated).toMatchObject({
            availability: STATE_AVAILABILITY.READY,
            hostname: "b.test",
            status: POPUP_STATUS.ACTIVE,
        });
    });
});
