# Passer les statistiques de MongoDB à PostgreSQL

Depuis la version 2 du module (refonte du front en 2020), l'écran Statistiques ne lit que l'API PostgreSQL
(`PGStatsService`, tables `stats.*`). En mode MongoDB (`mongo-stats-service: true` ou aucune conf PG),
`/stats/list` renvoie toujours une liste vide et l'écran reste vide : ce n'est pas une question de configuration.

Ce dossier contient de quoi basculer une plateforme dont les événements sont dans MongoDB (collection `events`)
vers la chaîne PostgreSQL, sans perdre l'historique.

| Fichier | Rôle |
|---|---|
| `migrate_mongo_events_to_pg.py` | Copie des événements MongoDB vers `events.<type>_events` |
| `backfill_stats.py` | Historique avant la bascule dans `stats.accounts_*` et `stats.access_*` (connexions, visiteurs, activations, comptes chargés / activés, accès, connecteurs, salles WebConference) |

Les tables, les migrations Edifice utiles, le trigger des salles WebConference et les premières partitions sont créés
par le module lui-même (`src/main/resources/sql`, voir [Schéma créé par le module](#schéma-créé-par-le-module)).

## Fonctionnement de la chaîne PostgreSQL

1. **Event store d'ent-core** (`PostgresqlEventStore`) : chaque événement est écrit dans `events.<type>_events`
   (`login_events`, `access_events`…), les types sans table vont dans `events.unknown_events`.
2. **pg-events** ([edificeio/pg-events](https://github.com/edificeio/pg-events)) : crée les tables à partir de
   [edificeio/stats-events-schema](https://github.com/edificeio/stats-events-schema) et gère les partitions.
3. **Agrégateur** (bibliothèque `com.opendigitaleducation:stats`) : synchronise `repository.*` depuis Neo4j et calcule
   les tables `stats.*`. Edifice le lance en programme autonome (`-Daction=...`) ; ce fork le lance depuis le module
   (cron `aggregation-cron`, voir [Agrégation par le module](#agrégation-par-le-module)).
4. **Module stats** : `PGStatsService` lit `stats.*` via `read-pg-config` (ou `event-store.postgresql-slave`).

## Étapes de migration

### 1. Préparer la base

Rien de spécifique : comme pour les autres modules SQL, le schéma est créé par l'utilisateur admin (`sql.persistor.admin`,
propriétaire de la base) et utilisé par l'utilisateur de l'ENT (`sql.persistor`, event store).

### 2. Démarrer le module stats avec ses scripts SQL

Voir [Schéma créé par le module](#schéma-créé-par-le-module) et [Agrégation par le module](#agrégation-par-le-module).

### 3. Basculer l'event store d'ent-core sur PostgreSQL

Configurer `event-store` dans la conf d'ent-core (`platform` + `postgresql`), redéployer et **noter l'heure de bascule** :
les événements postérieurs sont écrits directement dans PostgreSQL, la migration ne doit copier que les antérieurs.

### 4. Migrer les événements MongoDB

```bash
python3 -m venv venv && venv/bin/pip install pymongo==4.17.0 psycopg2-binary   # pymongo 4.18+ : MongoDB 4.4 minimum

RUN="venv/bin/python migrate_mongo_events_to_pg.py \
  --mongo-uri mongodb://<user>:<pwd>@<host>:27017/<db> --mongo-db <db> \
  --pg-dsn postgresql://<user>:<pwd>@<host>:5432/<base> \
  --platform-id <valeur de event-store.platform> \
  --to-date <heure de bascule, ex. 2026-10-20T08:00:00>"

$RUN --dry-run              # n'écrit rien : répartition, champs ignorés, partitions manquantes
$RUN --create-partitions    # migration
$RUN --create-partitions    # relance : doit donner inserted=0
```

Le script reprend la transformation de `PostgresqlEventStore#store` :

- `_id` → `id`, `event-type` → `event_type`, `userId` → `user_id`, `profil` → `profile`, `resource-type` → `resource_type` ;
- `date` (millisecondes) → timestamp local dans `--timezone` (défaut `Europe/Paris`, doit être le fuseau de la JVM d'ent-core) ;
- `structures`, `classes`, `groups`, `referer`, `sessionId` supprimés pour les types ayant une table ;
- types sans table → `events.unknown_events` avec un `payload` JSON (ignorés si `--allowed-events` est renseigné,
  comme `event-store.postgresql.allowed-events`) ;
- ip tronquée à la première virgule.

Il lit les colonnes réelles dans `information_schema` : un champ sans colonne correspondante n'est pas copié et est
listé dans le rapport (`deviceName`, `osName`, `osVersion`, `saml-type` sont attendus). Les chaînes plus longues que
la colonne sont tronquées et comptées. Les `id` déjà présents sont ignorés, le script peut être relancé.
MongoDB n'est jamais modifié.

| Option | Rôle |
|---|---|
| `--from-date` / `--to-date` | bornes sur la date des événements (ISO, `--to-date` exclue) |
| `--create-partitions` | crée les partitions mensuelles manquantes (`<table>YYYYMM`, index brin sur `date`) |
| `--allowed-events` | même liste que `event-store.postgresql.allowed-events` |
| `--batch-size` | taille des lots d'insertion (défaut 1000) |
| `--dry-run` | lecture seule, sans `--pg-dsn` utiliser `--known-events` pour simuler les tables existantes |

### 5. Recalculer les statistiques et basculer le module

Laisser passer l'agrégation du module sur l'historique migré, puis configurer le module stats en lecture PostgreSQL
(`read-pg-config`, sans `mongo-stats-service`) et vérifier l'écran.

## Connecteurs et salles WebConference

L'agrégateur range les connecteurs dans `stats.access_*` avec `type = 'CONNECTOR'` et
`module = COALESCE("cas-type", module)` (ex. `MOODLE`, `Moodle2`, `SSOMatrix`, `app-e`). Le module n'affiche que les
modules listés dans `api-allowed-values.json` (`modules`), avec le libellé i18n de la clé en minuscules.
Les connecteurs de la plateforme et les salles WebConference y ont été ajoutés ; une conf `api-allowed-values`
dans le `conf.json` remplace entièrement ce fichier.

Les events `ROOM_ACCESS` / `ROOM_CREATION` (indicateurs personnalisés de statistics-old) ne sont pas lus par
l'agrégateur. Le trigger créé par `sql/003-campus.sql` recopie chaque event de salle dans `events.connector_events`
(`"cas-type"` = `WebConferenceRoomAccess` / `WebConferenceRoomCreation`) : l'agrégateur les compte ensuite comme
n'importe quel connecteur, à tous les niveaux et toutes les fréquences, sans job supplémentaire.

| Fichier | Rôle |
|---|---|
| `backfill_stats.py` | Historique avant la bascule, depuis MongoDB : établissements et classes **au moment de l'event** |

Ordre à respecter :

1. démarrer le module stats (création du trigger) **avant** la bascule de l'event store ;
2. bascule de l'event store et premier passage de l'agrégateur (les tables `stats.*` contiennent alors des données
   postérieures à la bascule : l'agrégateur reprend à `MAX(date)` et ne revient plus sur l'historique) ;
3. historique :

   ```bash
   venv/bin/python backfill_stats.py --dry-run \
     --mongo-uri mongodb://<user>:<pwd>@<host>:27017/<db> --mongo-db <db> \
     --pg-dsn postgresql://<user>:<pwd>@<host>:5432/<base> \
     --platform-id <valeur de event-store.platform> --to-date <heure de bascule>
   ```

   puis sans `--dry-run`. Seules les périodes (heure, jour, semaine, mois) **terminées avant** `--to-date` sont écrites,
   la période en cours appartient à l'agrégateur. Les colonnes `*_wta` (rattachement direct) sont déduites de
   `repository.structures.parent_structures`. Les établissements, classes et tenants absents du référentiel sont
   ignorés (clés étrangères) et comptés dans le rapport. Le script est rejouable (`ON CONFLICT (id) DO UPDATE`).

   Formules reprises de l'agrégateur : `authentications` / `unique_visitors` sur les `LOGIN` des modules `Auth`,
   `app-e`, `Application Mobile` ; `activations` = utilisateurs distincts des `ACTIVATION` ; `access`,
   `unique_access_minute`, `unique_access` sur les `ACCESS` et `CONNECTOR`. `loaded` / `activated` ne sont pas dans
   les events : ils viennent des instantanés mensuels de statistics-old (collection `stats`, `ACCOUNTS` /
   `ACTIVATED_ACCOUNTS` par établissement et profil, état au 1er du mois), sommés pour la plateforme et le tenant
   (un utilisateur de plusieurs établissements y est compté plusieurs fois) ; il n'y en a pas au niveau classe.
   Les tables `*_device_*` ne sont pas remplies. `--indicators accounts` ou `--indicators access` limite la reprise.

Différence avec statistics-old : les Moodle ne sont plus regroupés sous `MoodleRegisteredService`, chaque instance
apparaît séparément (`cas-type`). Les valeurs de `cas-type` dépendent de la plateforme : vérifier celles de la prod
(`db.events.distinct("cas-type", {"event-type": "CONNECTOR"})`) et compléter `api-allowed-values.json` et l'i18n.

## Tester la migration sur une base jetable

```bash
sudo -u postgres psql -c "CREATE DATABASE tmp_mongo_events_migration"
cat ../src/main/resources/sql/0*.sql | sudo -u postgres psql -d tmp_mongo_events_migration -1 -v ON_ERROR_STOP=1 -q

RUN="sudo -u postgres venv/bin/python migrate_mongo_events_to_pg.py \
  --mongo-uri mongodb://<user>:<pwd>@<host>:27017/<db> --mongo-db <db> \
  --pg-dsn dbname=tmp_mongo_events_migration --platform-id test-platform"
$RUN --dry-run && $RUN --create-partitions && $RUN --create-partitions

sudo -u postgres psql -d tmp_mongo_events_migration -c \
  "SELECT count(*) AS doublons FROM (SELECT id FROM events.login_events GROUP BY id HAVING count(*) > 1) d"
sudo -u postgres psql -c "DROP DATABASE tmp_mongo_events_migration"
```

Comparer les volumes par table avec le dry-run et contrôler quelques lignes (date en heure locale, `platform_id`).

## Schéma créé par le module

Avec `"sql": true` dans sa conf, ent-core (`BaseServer`) exécute au démarrage les scripts `sql/*.sql` du module
qui n'ont pas encore été joués, dans une transaction, et les trace dans `stats.scripts` (`db-schema`, défaut `stats`).
Ils passent par `sql.persistor.admin` (`postgresConfig.sqlAdminAdress`, préfixé par le nœud en cluster comme pour
rbs) : les schémas et les tables appartiennent à l'utilisateur admin, l'utilisateur `apps` reçoit les droits de
lecture et d'écriture.

```json
"sql": true,
"db-schema": "stats"
```

| Script | Contenu |
|---|---|
| `001-stats-events-schema.sql` | `stats.scripts` et tables de [edificeio/stats-events-schema](https://github.com/edificeio/stats-events-schema) (`stats.json`, commit en tête du fichier), générées avec les règles de `PgEventsManager#createTableIfNotExists` |
| `002-edifice-migrations.sql` | Migrations 008, 013 et 020 du jar `com.opendigitaleducation:stats` (langues, traductions, fuseau des plateformes) |
| `003-campus.sql` | `source` en `varchar(16)` (rattachements `UNKNOWN` dans Neo4j), trigger salles WebConference → connecteurs |
| `004-partitions.sql` | Partitions mensuelles des tables `events.*_events`, du mois courant à +2 mois |
| `005-grants-permission-to-apps-role.sql` | Droits de `apps` sur les cinq schémas, y compris les partitions créées ensuite |
| `006-device-detection.sql` | Clé de `utils.ua_device` et index sur le navigateur des connexions (détection des appareils) |
| `007-campus-profile-labels.sql` | Libellés des profils ENT dans les exports comme l'ancien module statistics (Personnel pédagogique, Apprenant, Personnel, Utilisateur extérieur, Invité) |

Les scripts ne créent que ce qui manque : ils passent sur une base où le schéma a déjà été installé à la main, à
condition qu'il appartienne à l'utilisateur admin (sinon, en superutilisateur : `REASSIGN OWNED BY apps TO apps_admin`
dans la base, puis `SET ROLE apps_admin` et `005-grants-permission-to-apps-role.sql`).
Au démarrage, le module ajoute aussi la plateforme de l'event store (`event-store.platform`) dans
`repository.platforms` (conf facultative `platform-name`, `platform-timezone`, défaut `Europe/Paris`).


À la première installation, l'event store de chaque module liste les tables `events.*` à son démarrage, avant que
le module stats les ait créées : redémarrer vertx une fois les scripts passés. Les events écrits dans MongoDB
pendant ce temps sont repris par `migrate_mongo_events_to_pg.py`.

## Agrégation par le module

En mode PostgreSQL (`pg-config`), sur le nœud où `pg-aggregation` vaut `true` (un seul par plateforme), le cron
`aggregation-cron` du module enchaîne :

1. `sql/004-partitions.sql` via `sql.persistor.admin` : partitions du mois courant à +2 mois (seul le propriétaire
   d'une table partitionnée peut lui en ajouter) ;
2. synchronisation de `repository.*` depuis Neo4j (`neo4jConfig` d'ent-core) ;
3. avec `enable-with-device-aggregation`, type d'appareil des connexions déduit de leur navigateur (`DeviceDetectorTask`
   de l'agrégateur, depuis `device-init-date`, valeurs « Unknown » d'ent-core redétectées) ;
4. si les tables par appareil sont vides : leur historique, une fois, de `device-init-date` à aujourd'hui
   (`dates-interval` de l'agrégateur, les autres tables étant mises de côté) ;
5. agrégation des events dans `stats.*` (`Aggregator`), avec l'utilisateur de `pg-config`.

Avec `paginate-interval`, l'agrégateur ne traite qu'une page par passage (une semaine, deux mois) à partir de la
dernière date de chaque table, ou de `init-year` / `init-month` pour une table vide : une première page sans données
laisse la table vide et bloque à cette date. D'où la passe d'historique des tables par appareil plutôt qu'une date
d'initialisation.

Les options de l'agrégateur sont lues dans la conf du module : `enabled-frequencies`, `enable-without-device-aggregation`,
`enable-with-device-aggregation`, `enable-activation`, `enable-delete-old-links`, `paginate-interval`, `dates-interval`,
`init-year` / `init-month` (début des tables vides, défaut : mois du démarrage). Ce nœud synchronise aussi le référentiel
au démarrage du module. Sans `pg-config`, le cron lance l'ancienne agrégation MongoDB.

## Limites

- PostgreSQL ne garde pas les structures et classes de l'événement : l'agrégation les reprend du référentiel actuel
  (`repository.*`). Un utilisateur qui a changé d'établissement est compté dans le nouveau, un utilisateur supprimé
  n'est plus rattaché.
- Les données déjà agrégées dans la collection MongoDB `stats` ne sont pas reprises, seules les traces brutes le sont.
