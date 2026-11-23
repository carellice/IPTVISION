package com.carellice.iptvision.data

import org.junit.Assert.assertEquals
import org.junit.Test

class GroupChannelsTest {
    private fun ch(id: Int, name: String, cat: String = "1") = Channel(id, id, name, null, cat, null)

    @Test
    fun groupsQualitiesOfTheSameChannel() {
        val list = listOf(ch(1, "Rai 1 FHD"), ch(2, "Rai 1 UHD"), ch(3, "Rai 2 HD"), ch(4, "Rai 1 SD"), ch(5, "Rai 1 4K"), ch(6, "Rai 1 FHD", cat = "2"))
        val g = groupChannels(list, favorites = emptySet())
        assertEquals(listOf("Rai 1", "Rai 2 HD", "Rai 1 FHD"), g.map { it.name })
        assertEquals(listOf(2, 4, 5), g[0].alternates)
        assertEquals(1, g[0].streamId)
    }

    @Test
    fun favoriteVersionLeads() {
        val g = groupChannels(listOf(ch(1, "Canale 5 HD"), ch(2, "Canale 5 SD")), favorites = setOf(2))
        assertEquals(2, g.single().streamId)
        assertEquals(listOf(1), g.single().alternates)
    }

    @Test
    fun singleListJoinsCategoriesAndStartsFromBestQuality() {
        val list = listOf(ch(1, "Rai 1 SD"), ch(2, "Rai 1"), ch(3, "Rai 1 FHD", cat = "2"), ch(4, "Rai 1 4K", cat = "3"), ch(5, "Rai 1 HD"))
        val g = groupChannels(list, favorites = setOf(1), single = true).single()
        assertEquals("Rai 1", g.name)
        assertEquals(4, g.streamId)
        assertEquals(listOf(3, 5, 2, 1), g.alternates)
    }

    @Test
    fun keepsLanguagesApartAndCleansName() {
        assertEquals(2, groupChannels(listOf(ch(1, "Sky Sport ITA"), ch(2, "Sky Sport ENG")), emptySet()).size)
        assertEquals("Rai 1", TextHelpers.withoutQuality("Rai 1 | FHD"))
        assertEquals("HD", TextHelpers.withoutQuality("HD"))
    }
}
