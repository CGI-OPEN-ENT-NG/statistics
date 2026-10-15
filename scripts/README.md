# Passer les statistiques de MongoDB à PostgreSQL

Depuis la version 2 du module (refonte du front en 2020), l'écran Statistiques ne lit que l'API PostgreSQL
(`PGStatsService`, tables `stats.*`). En mode MongoDB (`mongo-stats-service: true` ou aucune conf PG),
`/stats/list` renvoie toujours une liste vide et l'écran reste vide : ce n'est pas une question de configuration.

Ce dossier contient de quoi basculer une plateforme dont les événements sont dans MongoDB (collection `events`)
vers la chaîne PostgreSQL, sans perdre l'historique.

| Fichier | Rôle |
|---|---|
| `stats-events-schema.sql` | DDL des schémas `events`, `repository`, `stats`, `utils`, `external` |
| `migrate_mongo_events_to_pg.py` | Copie des événements MongoDB vers `events.<type>_events` |

## Fonctionnement de la chaîne PostgreSQL

1. **Event store d'ent-core** (`PostgresqlEventStore`) : chaque événement est écrit dans `events.<type>_events`
   (`login_events`, `access_events`…), les types sans table vont dans `events.unknown_events`.
2. **pg-events** ([edificeio/pg-events](https://github.com/edificeio/pg-events)) : crée les tables à partir de
   [edificeio/stats-events-schema](https://github.com/edificeio/stats-events-schema) et gère les partitions.
3. **Service d'agrégation** (`com.opendigitaleducation:stats`) : synchronise `repository.*` depuis Neo4j et calcule
   les tables `stats.*` lues par le module.
4. **Module stats** : `PGStatsService` lit `stats.*` via `read-pg-config` (ou `event-store.postgresql-slave`).

## Étapes de migration

### 1. Créer la base

`stats-events-schema.sql` est généré depuis `stats.json` (commit indiqué en tête du fichier) avec les règles de
`PgEventsManager#createTableIfNotExists` : les tables `*_events` ont `id UUID`, `date TIMESTAMP` et sont partitionnées
par date. Aucune partition n'est créée.

```bash
psql -d <base> -v ON_ERROR_STOP=1 -f stats-events-schema.sql
```

Appliquer ensuite les migrations SQL embarquées dans le jar `com.opendigitaleducation:stats` (`migration/000` à `021`).

Ouvrir `pg_hba.conf` aux serveurs applicatifs (event store), au service d'agrégation et au module stats.

### 2. Déployer pg-events et le service d'agrégation

Voir leurs dépôts respectifs.

### 3. Basculer l'event store d'ent-core sur PostgreSQL

Configurer `event-store` dans la conf d'ent-core (`platform` + `postgresql`), redéployer et **noter l'heure de bascule** :
les événements postérieurs sont écrits directement dans PostgreSQL, la migration ne doit copier que les antérieurs.

### 4. Migrer les événements MongoDB

```bash
python3 -m venv venv && venv/bin/pip install pymongo psycopg2-binary

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

Lancer le service d'agrégation sur l'historique migré, puis configurer le module stats en lecture PostgreSQL
(`read-pg-config`, sans `mongo-stats-service`) et vérifier l'écran.

## Tester la migration sur une base jetable

```bash
sudo -u postgres psql -c "CREATE DATABASE tmp_mongo_events_migration"
sudo -u postgres psql -d tmp_mongo_events_migration -v ON_ERROR_STOP=1 -q -f stats-events-schema.sql

RUN="sudo -u postgres venv/bin/python migrate_mongo_events_to_pg.py \
  --mongo-uri mongodb://<user>:<pwd>@<host>:27017/<db> --mongo-db <db> \
  --pg-dsn dbname=tmp_mongo_events_migration --platform-id test-platform"
$RUN --dry-run && $RUN --create-partitions && $RUN --create-partitions

sudo -u postgres psql -d tmp_mongo_events_migration -c \
  "SELECT count(*) AS doublons FROM (SELECT id FROM events.login_events GROUP BY id HAVING count(*) > 1) d"
sudo -u postgres psql -c "DROP DATABASE tmp_mongo_events_migration"
```

Comparer les volumes par table avec le dry-run et contrôler quelques lignes (date en heure locale, `platform_id`).

## Limites

- PostgreSQL ne garde pas les structures et classes de l'événement : l'agrégation les reprend du référentiel actuel
  (`repository.*`). Un utilisateur qui a changé d'établissement est compté dans le nouveau, un utilisateur supprimé
  n'est plus rattaché.
- Les données déjà agrégées dans la collection MongoDB `stats` ne sont pas reprises, seules les traces brutes le sont.
