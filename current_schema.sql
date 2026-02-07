--
-- Dong Bong League - Production Schema
-- Dumped from Heroku Postgres (postgresql-objective-11889) on 2026-02-07
-- Postgres version: 16.10
--

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';
SET default_table_access_method = heap;

-- ============================================================================
-- TABLES
-- ============================================================================

--
-- leagues: One row per season. The core organizational unit.
--
CREATE TABLE public.leagues (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    season_year integer NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE SEQUENCE public.leagues_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.leagues_id_seq OWNED BY public.leagues.id;

--
-- teams: Fantasy teams belonging to a league.
--
CREATE TABLE public.teams (
    id integer NOT NULL,
    league_id integer,
    name character varying(100) NOT NULL,
    manager_name character varying(100) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE SEQUENCE public.teams_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.teams_id_seq OWNED BY public.teams.id;

--
-- players: MLB player pool. Shared across all leagues/seasons.
--
CREATE TABLE public.players (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    mlb_id integer NOT NULL,
    primary_position character varying(10) NOT NULL,
    current_mlb_team_id integer,
    status character varying DEFAULT 'Active'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE SEQUENCE public.players_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.players_id_seq OWNED BY public.players.id;

--
-- team_rosters: Player assignments to fantasy teams.
-- History tracked via effective_date/end_date (end_date NULL = current).
--
CREATE TABLE public.team_rosters (
    id integer NOT NULL,
    team_id integer,
    player_id integer,
    position character varying(10) NOT NULL,
    drafted_position character varying(10),
    status character varying(20) DEFAULT 'STARTER'::character varying NOT NULL,
    reason character varying(50),
    effective_date date NOT NULL,
    end_date date,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE SEQUENCE public.team_rosters_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.team_rosters_id_seq OWNED BY public.team_rosters.id;

--
-- roster_templates: Defines the roster structure (positions & slot counts) for a league.
--
CREATE TABLE public.roster_templates (
    id integer NOT NULL,
    league_id integer,
    position character varying(10) NOT NULL,
    count integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE SEQUENCE public.roster_templates_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.roster_templates_id_seq OWNED BY public.roster_templates.id;

--
-- player_game_stats: Per-game HR data from MLB API. Keyed by (player_id, game_id).
-- NOTE: No league_id or season scoping — relies on date range filtering.
--
CREATE TABLE public.player_game_stats (
    player_id integer NOT NULL,
    game_id integer NOT NULL,
    date date NOT NULL,
    home_runs integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

--
-- scores: HRs attributed to fantasy teams. One row per HR event.
-- NOTE: No league_id — scoped via team_id -> teams.league_id join.
--
CREATE TABLE public.scores (
    id integer NOT NULL,
    game_id integer NOT NULL,
    team_id integer,
    position character varying(10) NOT NULL,
    date date NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

CREATE SEQUENCE public.scores_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.scores_id_seq OWNED BY public.scores.id;

--
-- users: Authentication accounts.
--
CREATE TABLE public.users (
    id integer NOT NULL,
    email character varying NOT NULL,
    password_hash character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE SEQUENCE public.users_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;

--
-- user_teams: Maps users to teams with roles (manager, commissioner).
-- league_id allows commissioner role to be scoped per-league.
--
CREATE TABLE public.user_teams (
    id integer NOT NULL,
    user_id integer NOT NULL,
    team_id integer,
    role character varying NOT NULL DEFAULT 'manager'::character varying,
    league_id integer,
    created_at timestamp with time zone DEFAULT now()
);

CREATE SEQUENCE public.user_teams_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.user_teams_id_seq OWNED BY public.user_teams.id;

-- ============================================================================
-- DEFAULTS (sequence assignments)
-- ============================================================================

ALTER TABLE ONLY public.leagues ALTER COLUMN id SET DEFAULT nextval('public.leagues_id_seq'::regclass);
ALTER TABLE ONLY public.teams ALTER COLUMN id SET DEFAULT nextval('public.teams_id_seq'::regclass);
ALTER TABLE ONLY public.players ALTER COLUMN id SET DEFAULT nextval('public.players_id_seq'::regclass);
ALTER TABLE ONLY public.team_rosters ALTER COLUMN id SET DEFAULT nextval('public.team_rosters_id_seq'::regclass);
ALTER TABLE ONLY public.roster_templates ALTER COLUMN id SET DEFAULT nextval('public.roster_templates_id_seq'::regclass);
ALTER TABLE ONLY public.scores ALTER COLUMN id SET DEFAULT nextval('public.scores_id_seq'::regclass);
ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);
ALTER TABLE ONLY public.user_teams ALTER COLUMN id SET DEFAULT nextval('public.user_teams_id_seq'::regclass);

-- ============================================================================
-- PRIMARY KEYS
-- ============================================================================

ALTER TABLE ONLY public.leagues ADD CONSTRAINT leagues_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.teams ADD CONSTRAINT teams_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.players ADD CONSTRAINT players_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.team_rosters ADD CONSTRAINT team_rosters_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.roster_templates ADD CONSTRAINT roster_templates_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.player_game_stats ADD CONSTRAINT player_game_stats_pkey PRIMARY KEY (player_id, game_id);
ALTER TABLE ONLY public.scores ADD CONSTRAINT scores_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.user_teams ADD CONSTRAINT user_teams_pkey PRIMARY KEY (id);

-- ============================================================================
-- UNIQUE CONSTRAINTS
-- ============================================================================

ALTER TABLE ONLY public.players ADD CONSTRAINT players_mlb_id_key UNIQUE (mlb_id);
ALTER TABLE ONLY public.users ADD CONSTRAINT users_email_key UNIQUE (email);
ALTER TABLE ONLY public.user_teams ADD CONSTRAINT user_teams_user_id_team_id_key UNIQUE (user_id, team_id);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX idx_player_game_stats_date ON public.player_game_stats USING btree (date);
CREATE INDEX idx_scores_date ON public.scores USING btree (date);
CREATE INDEX idx_team_rosters_effective_date ON public.team_rosters USING btree (effective_date);
CREATE INDEX idx_users_email ON public.users USING btree (email);
CREATE INDEX idx_user_teams_user_id ON public.user_teams USING btree (user_id);
CREATE INDEX idx_user_teams_team_id ON public.user_teams USING btree (team_id);

-- ============================================================================
-- FOREIGN KEYS
-- ============================================================================

ALTER TABLE ONLY public.teams ADD CONSTRAINT teams_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id);
ALTER TABLE ONLY public.team_rosters ADD CONSTRAINT team_rosters_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id);
ALTER TABLE ONLY public.team_rosters ADD CONSTRAINT team_rosters_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id);
ALTER TABLE ONLY public.roster_templates ADD CONSTRAINT roster_templates_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id);
ALTER TABLE ONLY public.player_game_stats ADD CONSTRAINT player_game_stats_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id);
ALTER TABLE ONLY public.scores ADD CONSTRAINT scores_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id);
ALTER TABLE ONLY public.user_teams ADD CONSTRAINT user_teams_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);
ALTER TABLE ONLY public.user_teams ADD CONSTRAINT user_teams_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id);
ALTER TABLE ONLY public.user_teams ADD CONSTRAINT user_teams_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id);
