--
-- PostgreSQL database dump
--

-- Dumped from database version 15.10 (Homebrew)
-- Dumped by pg_dump version 15.12 (Homebrew)

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

--
-- Name: leagues; Type: TABLE; Schema: public; Owner: bgerson
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


ALTER TABLE public.leagues OWNER TO bgerson;

--
-- Name: leagues_id_seq; Type: SEQUENCE; Schema: public; Owner: bgerson
--

CREATE SEQUENCE public.leagues_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.leagues_id_seq OWNER TO bgerson;

--
-- Name: leagues_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: bgerson
--

ALTER SEQUENCE public.leagues_id_seq OWNED BY public.leagues.id;


--
-- Name: player_game_stats; Type: TABLE; Schema: public; Owner: bgerson
--

CREATE TABLE public.player_game_stats (
    player_id integer NOT NULL,
    game_id integer NOT NULL,
    date date NOT NULL,
    home_runs integer DEFAULT 0 NOT NULL
);


ALTER TABLE public.player_game_stats OWNER TO bgerson;

--
-- Name: players; Type: TABLE; Schema: public; Owner: bgerson
--

CREATE TABLE public.players (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    mlb_id integer NOT NULL,
    primary_position character varying(10) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    current_mlb_team_id integer
);


ALTER TABLE public.players OWNER TO bgerson;

--
-- Name: players_id_seq; Type: SEQUENCE; Schema: public; Owner: bgerson
--

CREATE SEQUENCE public.players_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.players_id_seq OWNER TO bgerson;

--
-- Name: players_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: bgerson
--

ALTER SEQUENCE public.players_id_seq OWNED BY public.players.id;


--
-- Name: roster_templates; Type: TABLE; Schema: public; Owner: bgerson
--

CREATE TABLE public.roster_templates (
    id integer NOT NULL,
    league_id integer,
    "position" character varying(10) NOT NULL,
    count integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.roster_templates OWNER TO bgerson;

--
-- Name: roster_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: bgerson
--

CREATE SEQUENCE public.roster_templates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.roster_templates_id_seq OWNER TO bgerson;

--
-- Name: roster_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: bgerson
--

ALTER SEQUENCE public.roster_templates_id_seq OWNED BY public.roster_templates.id;


--
-- Name: scores; Type: TABLE; Schema: public; Owner: bgerson
--

CREATE TABLE public.scores (
    id integer NOT NULL,
    game_id integer,
    team_id integer,
    "position" character varying(10) NOT NULL,
    date date NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.scores OWNER TO bgerson;

--
-- Name: scores_id_seq; Type: SEQUENCE; Schema: public; Owner: bgerson
--

CREATE SEQUENCE public.scores_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.scores_id_seq OWNER TO bgerson;

--
-- Name: scores_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: bgerson
--

ALTER SEQUENCE public.scores_id_seq OWNED BY public.scores.id;


--
-- Name: team_rosters; Type: TABLE; Schema: public; Owner: bgerson
--

CREATE TABLE public.team_rosters (
    id integer NOT NULL,
    team_id integer,
    player_id integer,
    "position" character varying(10) NOT NULL,
    status character varying(20) DEFAULT 'STARTER'::character varying NOT NULL,
    effective_date date NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    drafted_position character varying(10),
    reason character varying(50),
    end_date date
);


ALTER TABLE public.team_rosters OWNER TO bgerson;

--
-- Name: team_rosters_id_seq; Type: SEQUENCE; Schema: public; Owner: bgerson
--

CREATE SEQUENCE public.team_rosters_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.team_rosters_id_seq OWNER TO bgerson;

--
-- Name: team_rosters_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: bgerson
--

ALTER SEQUENCE public.team_rosters_id_seq OWNED BY public.team_rosters.id;


--
-- Name: teams; Type: TABLE; Schema: public; Owner: bgerson
--

CREATE TABLE public.teams (
    id integer NOT NULL,
    league_id integer,
    name character varying(100) NOT NULL,
    manager_name character varying(100) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.teams OWNER TO bgerson;

--
-- Name: teams_id_seq; Type: SEQUENCE; Schema: public; Owner: bgerson
--

CREATE SEQUENCE public.teams_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.teams_id_seq OWNER TO bgerson;

--
-- Name: teams_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: bgerson
--

ALTER SEQUENCE public.teams_id_seq OWNED BY public.teams.id;


--
-- Name: leagues id; Type: DEFAULT; Schema: public; Owner: bgerson
--

ALTER TABLE ONLY public.leagues ALTER COLUMN id SET DEFAULT nextval('public.leagues_id_seq'::regclass);


--
-- Name: players id; Type: DEFAULT; Schema: public; Owner: bgerson
--

ALTER TABLE ONLY public.players ALTER COLUMN id SET DEFAULT nextval('public.players_id_seq'::regclass);


--
-- Name: roster_templates id; Type: DEFAULT; Schema: public; Owner: bgerson
--

ALTER TABLE ONLY public.roster_templates ALTER COLUMN id SET DEFAULT nextval('public.roster_templates_id_seq'::regclass);


--
-- Name: scores id; Type: DEFAULT; Schema: public; Owner: bgerson
--

ALTER TABLE ONLY public.scores ALTER COLUMN id SET DEFAULT nextval('public.scores_id_seq'::regclass);


--
-- Name: team_rosters id; Type: DEFAULT; Schema: public; Owner: bgerson
--

ALTER TABLE ONLY public.team_rosters ALTER COLUMN id SET DEFAULT nextval('public.team_rosters_id_seq'::regclass);


--
-- Name: teams id; Type: DEFAULT; Schema: public; Owner: bgerson
--

ALTER TABLE ONLY public.teams ALTER COLUMN id SET DEFAULT nextval('public.teams_id_seq'::regclass);


--
-- Name: leagues leagues_pkey; Type: CONSTRAINT; Schema: public; Owner: bgerson
--

ALTER TABLE ONLY public.leagues
    ADD CONSTRAINT leagues_pkey PRIMARY KEY (id);


--
-- Name: player_game_stats player_game_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: bgerson
--

ALTER TABLE ONLY public.player_game_stats
    ADD CONSTRAINT player_game_stats_pkey PRIMARY KEY (player_id, game_id);


--
-- Name: players players_mlb_id_key; Type: CONSTRAINT; Schema: public; Owner: bgerson
--

ALTER TABLE ONLY public.players
    ADD CONSTRAINT players_mlb_id_key UNIQUE (mlb_id);


--
-- Name: players players_pkey; Type: CONSTRAINT; Schema: public; Owner: bgerson
--

ALTER TABLE ONLY public.players
    ADD CONSTRAINT players_pkey PRIMARY KEY (id);


--
-- Name: roster_templates roster_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: bgerson
--

ALTER TABLE ONLY public.roster_templates
    ADD CONSTRAINT roster_templates_pkey PRIMARY KEY (id);


--
-- Name: scores scores_pkey; Type: CONSTRAINT; Schema: public; Owner: bgerson
--

ALTER TABLE ONLY public.scores
    ADD CONSTRAINT scores_pkey PRIMARY KEY (id);


--
-- Name: team_rosters team_rosters_pkey; Type: CONSTRAINT; Schema: public; Owner: bgerson
--

ALTER TABLE ONLY public.team_rosters
    ADD CONSTRAINT team_rosters_pkey PRIMARY KEY (id);


--
-- Name: teams teams_pkey; Type: CONSTRAINT; Schema: public; Owner: bgerson
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_pkey PRIMARY KEY (id);


--
-- Name: idx_scores_date; Type: INDEX; Schema: public; Owner: bgerson
--

CREATE INDEX idx_scores_date ON public.scores USING btree (date);


--
-- Name: idx_team_rosters_effective_date; Type: INDEX; Schema: public; Owner: bgerson
--

CREATE INDEX idx_team_rosters_effective_date ON public.team_rosters USING btree (effective_date);


--
-- Name: player_game_stats player_game_stats_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: bgerson
--

ALTER TABLE ONLY public.player_game_stats
    ADD CONSTRAINT player_game_stats_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id);


--
-- Name: roster_templates roster_templates_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: bgerson
--

ALTER TABLE ONLY public.roster_templates
    ADD CONSTRAINT roster_templates_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id);


--
-- Name: scores scores_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: bgerson
--

ALTER TABLE ONLY public.scores
    ADD CONSTRAINT scores_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id);


--
-- Name: team_rosters team_rosters_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: bgerson
--

ALTER TABLE ONLY public.team_rosters
    ADD CONSTRAINT team_rosters_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id);


--
-- Name: team_rosters team_rosters_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: bgerson
--

ALTER TABLE ONLY public.team_rosters
    ADD CONSTRAINT team_rosters_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id);


--
-- Name: teams teams_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: bgerson
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id);


--
-- PostgreSQL database dump complete
--

