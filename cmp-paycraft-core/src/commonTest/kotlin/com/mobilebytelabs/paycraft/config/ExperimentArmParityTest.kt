package com.mobilebytelabs.paycraft.config

import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * The server resolves a device's A/B arm itself (`_shared/experiment-arm.ts`) so tests need no app release. It must
 * pick the SAME arm the SDK does, or a device's events and its config would disagree. These vectors are pinned in
 * `supabase/functions/__tests__/experiment-arm.test.ts` too — change one side, both fail.
 */
class ExperimentArmParityTest {
    private val experiment = ExperimentDto(
        key = "price-test",
        variants = listOf(
            ExperimentVariantDto("a", 50, "o"),
            ExperimentVariantDto("b", 30, "o"),
            ExperimentVariantDto("c", 20, "o"),
        ),
    )

    private val vectors = mapOf(
        "dev-0" to "a",
        "dev-1" to "a",
        "dev-2" to "a",
        "ünïcödé-id" to "a",
        "9f1c2e3a-0b7d-4c55-8e21-3a4b5c6d7e8f" to "a",
        "dev-7" to "b",
        "dev-9" to "b",
        "dev-11" to "b",
        "dev-3" to "c",
        "dev-6" to "c",
        "dev-8" to "c",
    )

    @Test fun the_sdk_picks_the_same_arm_as_the_server() {
        vectors.forEach { (id, arm) -> assertEquals(arm, experiment.assign(id)?.key, id) }
    }
}
