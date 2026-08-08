-- Tabla para las puertas de salida
CREATE TABLE IF NOT EXISTS exit_doors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabla para los grados escolares
CREATE TABLE IF NOT EXISTS school_grades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL, -- Ej: "Maternal", "Kinder", "1er Grado", "12vo Grado"
    level_order INTEGER NOT NULL, -- Para ordenar los grados lógicamente (1, 2, 3...)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabla para relacionar grados con puertas de salida
CREATE TABLE IF NOT EXISTS grade_doors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grade_id UUID REFERENCES school_grades(id) ON DELETE CASCADE,
    door_id UUID REFERENCES exit_doors(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(grade_id, door_id)
);

-- Insertar datos por defecto (Opcional)
INSERT INTO exit_doors (name, description) VALUES 
('Puerta Principal', 'Salida principal del edificio'),
('Puerta Trasera', 'Salida hacia el estacionamiento trasero')
ON CONFLICT DO NOTHING;

INSERT INTO school_grades (name, level_order) VALUES 
('Maternal', 1),
('Pre-Kinder', 2),
('Kinder', 3),
('1er Grado', 4),
('2do Grado', 5),
('3er Grado', 6),
('4to Grado', 7),
('5to Grado', 8),
('6to Grado', 9),
('7mo Grado', 10),
('8vo Grado', 11),
('9no Grado', 12),
('10mo Grado', 13),
('11vo Grado', 14),
('12vo Grado', 15)
ON CONFLICT DO NOTHING;
