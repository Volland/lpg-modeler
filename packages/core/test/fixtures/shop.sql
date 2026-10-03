-- A small shop schema, shaped the way pg_dump writes one.
SET statement_timeout = 0;

CREATE TYPE order_status AS ENUM ('placed', 'shipped', 'cancelled');

CREATE TABLE person (
    id uuid PRIMARY KEY,
    email character varying(255) NOT NULL,
    name text NOT NULL,
    balance numeric(10, 2),
    tags text[],
    location point
);

CREATE TABLE product (
    sku text NOT NULL,
    price numeric(10, 2) NOT NULL,
    stock integer DEFAULT 0
);

ALTER TABLE ONLY product
    ADD CONSTRAINT product_pkey PRIMARY KEY (sku);

CREATE TABLE orders (
    id bigserial PRIMARY KEY,
    buyer_id uuid NOT NULL REFERENCES person(id),
    status order_status NOT NULL,
    placed_at timestamp with time zone NOT NULL
);

-- Primary key is exactly the two foreign keys: an edge type, not a node type.
CREATE TABLE order_line (
    order_id bigint NOT NULL REFERENCES orders(id),
    product_sku text NOT NULL REFERENCES product(sku),
    quantity integer NOT NULL,
    PRIMARY KEY (order_id, product_sku)
);

-- A unique foreign key: each person has at most one profile.
CREATE TABLE profile (
    id uuid PRIMARY KEY,
    person_id uuid NOT NULL UNIQUE REFERENCES person(id),
    bio text
);

CREATE UNIQUE INDEX person_email_key ON person USING btree (email);

CREATE INDEX person_name_idx ON person USING btree (name);
GRANT ALL ON TABLE person TO shop_app;
