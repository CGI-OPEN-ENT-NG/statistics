-- Migrations 008 and 020 of the edificeio/stats aggregator (2.0.5): languages and translations.
-- Applied only when utils.translations is missing (database where they were already applied).
DO $migration$
BEGIN
IF to_regclass('utils.translations') IS NULL THEN

CREATE TABLE utils.languages (
    language_key varchar(8) PRIMARY KEY,
    name varchar(32)
);

INSERT INTO utils.languages(language_key, name) VALUES ('fr', 'Français');
INSERT INTO utils.languages(language_key, name) VALUES ('en', 'English');

CREATE TABLE utils.translations (
    key varchar(64),
    item_type varchar(32) NOT NULL,
    language_key varchar(8) NOT NULL,
    translation varchar(512) NOT NULL,
    PRIMARY KEY (key, language_key),
    CONSTRAINT language_key_fk FOREIGN KEY(language_key) REFERENCES utils.languages(language_key) ON DELETE CASCADE
);



INSERT INTO utils.translations(key, item_type, language_key, translation) VALUES 
    ('Personnel', 'profile', 'fr', 'Personnel'),
    ('Teacher', 'profile', 'fr', 'Enseignant'),
    ('Student', 'profile', 'fr', 'Élève'),
    ('Relative', 'profile', 'fr', 'Parent'),
    ('Guest', 'profile', 'fr', 'Invité');

INSERT INTO utils.translations(key, item_type, language_key, translation) VALUES 
    ('Personnel', 'profile', 'en', 'Personnel'),
    ('Teacher', 'profile', 'en', 'Teacher'),
    ('Student', 'profile', 'en', 'Student'),
    ('Relative', 'profile', 'en', 'Relative'),
    ('Guest', 'profile', 'en', 'Guest');

INSERT INTO utils.translations(key, item_type, language_key, translation) VALUES 
    ('ShareBigFiles', 'module', 'fr', 'Partage de fichiers lourds'),
    ('ClassParam', 'module', 'fr', 'Paramétrage de la classe'),
    ('Calendar', 'module', 'fr', 'Agenda'),
    ('Pages', 'module', 'fr', 'Pages'),
    ('Scrapbook', 'module', 'fr', 'Cahier multimedia'),
    ('CollaborativeWall', 'module', 'fr', 'Mur collaboratif'),
    ('Poll', 'module', 'fr', 'Sondage'),
    ('Actualites', 'module', 'fr', 'Actualités'),
    ('Annuaire', 'module', 'fr', 'Annuaire'),
    ('Homeworks', 'module', 'fr', 'Cahier de textes'),
    ('Conversation', 'module', 'fr', 'Messagerie'),
    ('MyAccount', 'module', 'fr', 'Mon compte'),
    ('SchoolBook', 'module', 'fr', 'Carnet de liaison'),
    ('Rbs', 'module', 'fr', 'Réservation de ressources'),
    ('Website', 'module', 'fr', 'WebSites'),
    ('Exercizer', 'module', 'fr', 'Exercices'),
    ('Archive', 'module', 'fr', 'Archive'),
    ('Support', 'module', 'fr', 'Support'),
    ('Community', 'module', 'fr', 'Communautés'),
    ('TimelineGenerator', 'module', 'fr', 'Frise chronologiques'),
    ('Workspace', 'module', 'fr', 'Espace documentaire'),
    ('Mindmap', 'module', 'fr', 'Carte mentale'),
    ('Blog', 'module', 'fr', 'Blog'),
    ('Forum', 'module', 'fr', 'Forum'),
    ('Zimbra', 'module', 'fr', 'Messagerie'),
    ('Admin', 'module', 'fr', 'Console administration'),
    ('Mediacentre', 'module', 'fr', 'Mediacentre'),
    ('Wiki', 'module', 'fr', 'Wiki'),
    ('WebConference', 'module', 'fr', 'WebConference'),
    ('CollaborativeEditor', 'module', 'fr', 'Pad'),
    ('Presences', 'module', 'fr', 'Presences'),
    ('Stats', 'module', 'fr', 'Stats'),
    ('Rack', 'module', 'fr', 'Casier'),
    ('Competences', 'module', 'fr', 'Compétences'),
    ('Edt', 'module', 'fr', 'Edt'),
    ('Diary', 'module', 'fr', 'Cahier de Textes'),
    ('Lool', 'module', 'fr', 'LooL'),
    ('Moodle', 'module', 'fr', 'Moodle')
;


INSERT INTO utils.translations(key, item_type, language_key, translation) VALUES 
    ('ShareBigFiles', 'module', 'en', 'Big file sharing tool'),
    ('ClassParam', 'module', 'en', 'Class settings'),
    ('Calendar', 'module', 'en', 'Calendar'),
    ('Pages', 'module', 'en', 'Pages'),
    ('Scrapbook', 'module', 'en', 'Multimedia notebook'),
    ('CollaborativeWall', 'module', 'en', 'Collaborative wall'),
    ('Poll', 'module', 'en', 'Poll'),
    ('Actualites', 'module', 'en', 'News'),
    ('Annuaire', 'module', 'en', 'Directory'),
    ('Homeworks', 'module', 'en', 'Homeworks'),
    ('Conversation', 'module', 'en', 'Mailbox'),
    ('MyAccount', 'module', 'en', 'My account'),
    ('SchoolBook', 'module', 'en', 'School book'),
    ('Rbs', 'module', 'en', 'Resource reservation'),
    ('Website', 'module', 'en', 'Website'),
    ('Exercizer', 'module', 'en', 'Exercizer'),
    ('Archive', 'module', 'en', 'My data'),
    ('Support', 'module', 'en', 'Assistance'),
    ('Community', 'module', 'en', 'Community'),
    ('TimelineGenerator', 'module', 'en', 'Timeline'),
    ('Workspace', 'module', 'en', 'File space'),
    ('Mindmap', 'module', 'en', 'Mindmap'),
    ('Blog', 'module', 'en', 'Blog'),
    ('Forum', 'module', 'en', 'Forum'),
    ('Zimbra', 'module', 'en', 'Mailbox'),
    ('Admin', 'module', 'en', 'Administration console'),
    ('Mediacentre', 'module', 'en', 'Mediacentre'),
    ('Wiki', 'module', 'en', 'Wiki'),
    ('WebConference', 'module', 'en', 'Video conference'),
    ('CollaborativeEditor', 'module', 'en', 'Pad'),
    ('Presences', 'module', 'en', 'Presences'),
    ('Stats', 'module', 'en', 'Statistics'),
    ('Rack', 'module', 'en', 'Rack'),
    ('Competences', 'module', 'en', 'Competences'),
    ('Edt', 'module', 'en', 'Edt'),
    ('Diary', 'module', 'en', 'Cahier de Textes'),
    ('Lool', 'module', 'en', 'LooL'),
    ('Moodle', 'module', 'en', 'Moodle');


INSERT INTO utils.translations(key, item_type, language_key, translation) VALUES 
    ('desktop', 'device_type', 'fr', 'Ordinateur (desktop)'),
    ('mobile_app', 'device_type', 'fr', 'Application mobile'),
    ('phablet', 'device_type', 'fr', 'Responsive Mobile'),
    ('smartphone', 'device_type', 'fr', 'Responsive Mobile'),
    ('tablet', 'device_type', 'fr', 'Responsive Tablette'),
    ('camera', 'device_type', 'fr', 'Autre'),
    ('console', 'device_type', 'fr', 'Autre'),
    ('feature phone', 'device_type', 'fr', 'Autre'),
    ('peripheral', 'device_type', 'fr', 'Autre'),
    ('portable media player', 'device_type', 'fr', 'Autre'),
    ('tv', 'device_type', 'fr', 'Autre'),
    ('unknown', 'device_type', 'fr', 'Autre'),
    ('wearable', 'device_type', 'fr', 'Autre');

INSERT INTO utils.translations(key, item_type, language_key, translation) VALUES
('CETAD (TOM)', 'niveau', 'fr', 'COLLEGE'),
('COLLEGE', 'niveau', 'fr', 'COLLEGE'),
('Collège', 'niveau', 'fr', 'COLLEGE'),
('COLLEGE SPECIALISE', 'niveau', 'fr', 'COLLEGE'),
('Ecole', 'niveau', 'fr', '?'),
('ECOLE DE NIVEAU ELEMENTAIRE', 'niveau', 'fr', 'ECOLE ELEMENTAIRE'),
('ECOLE DE NIVEAU ELEMENTAIRE SPECIALISEE', 'niveau', 'fr', 'ECOLE ELEMENTAIRE'),
('ECOLE ELEMENTAIRE ANNEXE D ESPE', 'niveau', 'fr', 'ECOLE ELEMENTAIRE'),
('ECOLE ELEMENTAIRE D APPLICATION', 'niveau', 'fr', 'ECOLE ELEMENTAIRE'),
('ECOLE MATERNELLE', 'niveau', 'fr', 'ECOLE MATERNELLE'),
('ECOLE MATERNELLE ANNEXE D ESPE', 'niveau', 'fr', 'ECOLE MATERNELLE'),
('ECOLE MATERNELLE D APPLICATION', 'niveau', 'fr', 'ECOLE MATERNELLE'),
('ECOLE REGIONALE DU PREMIER DEGRE', 'niveau', 'fr', 'ECOLE MATERNELLE'),
('ECOLE SANS EFFECTIFS PERMANENTS', 'niveau', 'fr', 'ECOLE MATERNELLE'),
('ECOLE SECONDAIRE SPECIALISEE (2 D CYCLE)', 'niveau', 'fr', 'COLLEGE + LYCEE'),
('ETABLISSEMENT DE REINSERTION SCOLAIRE', 'niveau', 'fr', 'COLLEGE'),
('ETABLISSEMENT EXPERIMENTAL', 'niveau', 'fr', '?'),
('ETABLISSEMENT REGIONAL D''ENSEIGNT ADAPTE', 'niveau', 'fr', 'COLLEGE + LYCEE'),
('GROUPEMENT D OBSERVATION DISPERSE', 'niveau', 'fr', 'COLLEGE'),
('Information et orientation', 'niveau', 'fr', 'AUTRE'),
('Lycée', 'niveau', 'fr', 'LYCEE'),
('LYCEE D ENSEIGNEMENT GENERAL', 'niveau', 'fr', 'LYCEE'),
('LYCEE D ENSEIGNEMENT TECHNOLOGIQUE', 'niveau', 'fr', 'LYCEE'),
('LYCEE ENSEIGNT GENERAL ET TECHNOLOGIQUE', 'niveau', 'fr', 'LYCEE'),
('LYCEE POLYVALENT', 'niveau', 'fr', 'LYCEE'),
('LYCEE PROFESSIONNEL', 'niveau', 'fr', 'LYCEE'),
('SECTION D ENSEIGNEMENT PROFESSIONNEL', 'niveau', 'fr', 'COLLEGE'),
('SECTION ENSEIGNT GEN. ET PROF. ADAPTE', 'niveau', 'fr', 'COLLEGE'),
('SECTION ENSEIGT GENERAL ET TECHNOLOGIQUE', 'niveau', 'fr', 'LYCEE'),
('Service Administratif', 'niveau', 'fr', 'AUTRE');

INSERT INTO utils.translations(key, item_type, language_key, translation) VALUES 
    ('car browser', 'device_type', 'fr', 'Autre'),
    ('smart display', 'device_type', 'fr', 'Responsive Tablette');

INSERT INTO utils.translations(key, item_type, language_key, translation) VALUES
    ('Formulaire', 'module', 'fr', 'Formulaire');

INSERT INTO utils.translations(key, item_type, language_key, translation) VALUES
    ('Formulaire', 'module', 'en', 'Form');

END IF;
END $migration$;

-- Migration 013 of the edificeio/stats aggregator, without the updates of the Edifice platforms
ALTER TABLE repository.platforms ADD COLUMN IF NOT EXISTS timezone VARCHAR(32);
