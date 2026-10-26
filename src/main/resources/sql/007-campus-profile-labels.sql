-- Labels of the ENT profiles in the exports, as in the former statistics module (campus-numerique theme): the data
-- keep the ENT profiles, only their translation changes (same labels as stats.<profile> in i18n).
UPDATE utils.translations t SET translation = l.translation
FROM (VALUES
    ('Teacher', 'fr', 'Personnel pédagogique'),
    ('Student', 'fr', 'Apprenant'),
    ('Personnel', 'fr', 'Personnel'),
    ('Relative', 'fr', 'Utilisateur extérieur'),
    ('Guest', 'fr', 'Invité'),
    ('Teacher', 'en', 'Teaching staff'),
    ('Student', 'en', 'Learner'),
    ('Personnel', 'en', 'Staff'),
    ('Relative', 'en', 'External user'),
    ('Guest', 'en', 'Guest')
) AS l (key, language_key, translation)
WHERE t.item_type = 'profile' AND t.key = l.key AND t.language_key = l.language_key;
