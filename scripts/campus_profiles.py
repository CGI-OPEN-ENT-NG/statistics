"""Campus profiles (name of the KC_Profile nodes in Neo4j) of the events written before they existed.

An old event only has the ENT profile: each person gets one of the Campus profiles of this ENT profile, always the
same, chosen from the hash of the user id (about 1/3 of the "Personnel" people in each of the 3 profiles), and all
their events of this ENT profile get it. Events without profile are "Invité".
"""
import hashlib

LEGACY_PROFILES = {
    "Personnel": ["Référent digital", "Gestionnaire d'inscription", "Responsable communication"],
    "Teacher": ["Personnel pédagogique"],
    "Student": ["Apprenant", "Elève du secondaire"],
    "Relative": ["Utilisateur extérieur"],
    "Guest": ["Invité"],
}
NO_PROFILE = ["Invité"]
# ENT profiles written as text by the event store or statistics-old when the user had none
NO_PROFILE_VALUES = ["null", ""]
# hexadecimal digits of md5(user id) choosing the profile: same value in Python and PostgreSQL (bit(28) -> int)
HASH_DIGITS = 7


def campus_profiles(legacy_profile):
    """Campus profiles of this ENT profile, None if it is already a Campus profile."""
    if legacy_profile is None or legacy_profile in NO_PROFILE_VALUES:
        return NO_PROFILE
    return LEGACY_PROFILES.get(legacy_profile)


def person_index(user_id):
    """Index of the Campus profile of a person, same as the SQL of remap_profiles.py."""
    return int(hashlib.md5((user_id or "").encode("utf-8")).hexdigest()[:HASH_DIGITS], 16)


def campus_profile(legacy_profile, user_id):
    """Campus profile of the event of a person with this ENT profile (unchanged if already a Campus profile)."""
    profiles = campus_profiles(legacy_profile)
    if profiles is None:
        return legacy_profile
    return profiles[person_index(user_id) % len(profiles)]


def legacy_profile_of(campus):
    """ENT profile of a Campus profile given by this mapping, None for any other value."""
    for legacy, profiles in LEGACY_PROFILES.items():
        if campus in profiles:
            return legacy
    return None


def split_count(count, profiles):
    """Integer split of a count between profiles, the remainder going to the first ones (10 -> 4, 3, 3)."""
    base, remainder = divmod(count, len(profiles))
    return {profile: base + (1 if i < remainder else 0) for i, profile in enumerate(profiles)}
