-- Labels of the Campus profiles (name of the KC_Profile nodes) in the exports, like the ENT profiles
INSERT INTO utils.translations (key, item_type, language_key, translation) VALUES
    ('Personnel pédagogique', 'profile', 'fr', 'Personnel pédagogique'),
    ('Référent digital', 'profile', 'fr', 'Référent digital'),
    ('Gestionnaire d''inscription', 'profile', 'fr', 'Gestionnaire d''inscription'),
    ('Responsable communication', 'profile', 'fr', 'Responsable communication'),
    ('Apprenant', 'profile', 'fr', 'Apprenant'),
    ('Elève du secondaire', 'profile', 'fr', 'Elève du secondaire'),
    ('Parent', 'profile', 'fr', 'Parent'),
    ('Utilisateur extérieur', 'profile', 'fr', 'Utilisateur extérieur'),
    ('Invité', 'profile', 'fr', 'Invité'),
    ('Personnel pédagogique', 'profile', 'en', 'Teaching staff'),
    ('Référent digital', 'profile', 'en', 'Digital referent'),
    ('Gestionnaire d''inscription', 'profile', 'en', 'Registration manager'),
    ('Responsable communication', 'profile', 'en', 'Communication manager'),
    ('Apprenant', 'profile', 'en', 'Learner'),
    ('Elève du secondaire', 'profile', 'en', 'Secondary school student'),
    ('Parent', 'profile', 'en', 'Parent'),
    ('Utilisateur extérieur', 'profile', 'en', 'External user'),
    ('Invité', 'profile', 'en', 'Guest')
ON CONFLICT (key, language_key) DO NOTHING;
