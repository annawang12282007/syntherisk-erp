ALTER TABLE departments ADD COLUMN name_zh text NOT NULL DEFAULT '',ADD COLUMN name_en text NOT NULL DEFAULT '',ADD COLUMN description_zh text NOT NULL DEFAULT '',ADD COLUMN description_en text NOT NULL DEFAULT '',ADD COLUMN deleted_at timestamptz;
ALTER TABLE department_jobs ADD COLUMN name_zh text NOT NULL DEFAULT '',ADD COLUMN name_en text NOT NULL DEFAULT '',ADD COLUMN deleted_at timestamptz;
ALTER TABLE operator_configuration ADD COLUMN name_zh text NOT NULL DEFAULT '企业管理员',ADD COLUMN name_en text NOT NULL DEFAULT 'Organization Administrator';
UPDATE operator_configuration SET name='企业管理员',name_zh='企业管理员',name_en='Organization Administrator',version=version+1;
ALTER TABLE operator_configuration ALTER COLUMN name SET DEFAULT '企业管理员';
UPDATE departments SET name_zh=CASE name WHEN 'IT部門' THEN 'IT部门' WHEN '財務部門' THEN '财务部门' WHEN '運營部門' THEN '运营部门' ELSE name END,
 name_en=CASE name WHEN 'IT部門' THEN 'IT Department' WHEN 'IT部门' THEN 'IT Department' WHEN '財務部門' THEN 'Finance Department' WHEN '财务部门' THEN 'Finance Department' WHEN '運營部門' THEN 'Operations Department' WHEN '运营部门' THEN 'Operations Department' ELSE '' END,
 description_zh=CASE description WHEN '可編輯的初始部門' THEN '可编辑的初始部门' ELSE description END,
 description_en=CASE WHEN description IN ('可編輯的初始部門','可编辑的初始部门') THEN 'Editable initial department' ELSE '' END;
UPDATE department_jobs SET name_zh=CASE name WHEN '一般員工' THEN '普通员工' WHEN '部門主管' THEN '部门主管' WHEN '財務管理員' THEN '财务管理员' ELSE name END,
 name_en=CASE name WHEN '一般員工' THEN 'Staff Member' WHEN '一般员工' THEN 'Staff Member' WHEN '部門主管' THEN 'Department Manager' WHEN '部门主管' THEN 'Department Manager' WHEN '財務管理員' THEN 'Finance Administrator' WHEN '财务管理员' THEN 'Finance Administrator' ELSE '' END;
CREATE OR REPLACE FUNCTION initialize_departments(w uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE d uuid; label text; english text; p text;
BEGIN
 -- Initialize once. Department renames/removals must not recreate seed departments.
 IF EXISTS(SELECT 1 FROM operator_configuration WHERE workspace_id=w) THEN RETURN; END IF;
 INSERT INTO operator_configuration(workspace_id) VALUES(w) ON CONFLICT DO NOTHING;
 FOR label,english,p IN SELECT * FROM (VALUES('IT部门','IT Department','IT'),('财务部门','Finance Department','FIN'),('运营部门','Operations Department','OPS')) AS defaults(name,en,prefix) LOOP
  INSERT INTO departments(workspace_id,name,name_zh,name_en,prefix,permissions) VALUES(w,label,label,english,p,'[{"resource":"team_directory","operation":"read","scope":"all"}]') ON CONFLICT(workspace_id,name) DO NOTHING RETURNING id INTO d;
  IF d IS NOT NULL THEN
   INSERT INTO department_jobs(department_id,name,name_zh,name_en,prefix,permissions) VALUES(d,'普通员工','普通员工','Staff Member',p,'[{"resource":"team_directory","operation":"edit","scope":"own"}]'),(d,'部门主管','部门主管','Department Manager',p,'[{"resource":"team_directory","operation":"edit","scope":"own"}]');
   IF p='FIN' THEN INSERT INTO department_jobs(department_id,name,name_zh,name_en,prefix,permissions) VALUES(d,'财务管理员','财务管理员','Finance Administrator',p,'[{"resource":"finance_management","operation":"operate","scope":"all"}]'); END IF;
  END IF;
 END LOOP;
END $$;
