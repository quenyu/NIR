%% Верификация примеров курсового проекта в Simulink
% Скрипт сам собирает в Simulink три схемы из главы 3 записки КП (ПИ-регулятор, перекрёстные
% обратные связи, ЭГСП 8-го порядка), моделирует их и сохраняет для каждой:
%   kp_<имя>.slx           — модель Simulink (можно открыть и посмотреть);
%   kp_<имя>.png           — картинка схемы;
%   simulink_<имя>.csv     — сигнал осциллографа: столбцы t, y.
% Запуск: открыть MATLAB (в том числе MATLAB Online), перейти в папку со скриптом и выполнить
%   kp_simulink
% Файлы simulink_*.csv кладутся в docs/study/, после этого
%   python scripts/kp_verification.py
% накладывает графики Simulink на графики Control Lab.

clear; clc;
models = {
    'kp_pi',      @build_pi,      15,  0.01
    'kp_crossed', @build_crossed, 10,  0.01
    'kp_egsp',    @build_egsp,    0.7, 0.0005
};
for k = 1:size(models, 1)
    [name, build, t_end, dt] = models{k, :};
    build(name);
    run_and_save(name, t_end, dt);
end
disp('Готово: kp_*.slx, kp_*.png, simulink_*.csv');

%% Контур с ПИ-регулятором: Kп = 2, Kи = 1, объект 1/(s+1) · 1/(0,5s+1), единичная обратная связь
function build_pi(m)
    new_model(m);
    blk(m, 'simulink/Sources/Step', 'r', [30 95 60 125], 'Time', '0', 'Before', '0', 'After', '1');
    blk(m, 'simulink/Math Operations/Sum', 'e', [110 95 140 125], 'Inputs', '|+-', 'IconShape', 'round');
    blk(m, 'simulink/Continuous/PID Controller', 'PI', [190 90 260 130], 'Controller', 'PI', 'P', '2', 'I', '1');
    blk(m, 'simulink/Continuous/Transfer Fcn', 'G1', [310 90 390 130], 'Numerator', '1', 'Denominator', '[1 1]');
    blk(m, 'simulink/Continuous/Transfer Fcn', 'G2', [440 90 520 130], 'Numerator', '1', 'Denominator', '[0.5 1]');
    blk(m, 'simulink/Sinks/Scope', 'Scope', [600 90 630 130]);
    blk(m, 'simulink/Sinks/Out1', 'y', [600 160 630 175]);
    ln(m, 'r/1', 'e/1'); ln(m, 'e/1', 'PI/1'); ln(m, 'PI/1', 'G1/1'); ln(m, 'G1/1', 'G2/1');
    ln(m, 'G2/1', 'Scope/1'); ln(m, 'G2/1', 'y/1'); ln(m, 'G2/1', 'e/2');
end

%% Перекрёстные обратные связи: G1 = 1/(s+1), G2 = 2/(0,5s+1), G3 = 1/s, H1 = 0,5 (с G2 на вход G1),
%  H2 = 1 (с G3 на вход G2), главная единичная обратная связь
function build_crossed(m)
    new_model(m);
    blk(m, 'simulink/Sources/Step', 'r', [30 95 60 125], 'Time', '0', 'Before', '0', 'After', '1');
    blk(m, 'simulink/Math Operations/Sum', 'S1', [110 90 140 130], 'Inputs', '+--');
    blk(m, 'simulink/Continuous/Transfer Fcn', 'G1', [180 90 260 130], 'Numerator', '1', 'Denominator', '[1 1]');
    blk(m, 'simulink/Math Operations/Sum', 'S2', [300 90 330 130], 'Inputs', '+-');
    blk(m, 'simulink/Continuous/Transfer Fcn', 'G2', [370 90 450 130], 'Numerator', '2', 'Denominator', '[0.5 1]');
    blk(m, 'simulink/Continuous/Integrator', 'G3', [500 95 530 125]);
    blk(m, 'simulink/Math Operations/Gain', 'H1', [300 190 340 220], 'Gain', '0.5', 'Orientation', 'left');
    blk(m, 'simulink/Math Operations/Gain', 'H2', [410 20 450 50], 'Gain', '1', 'Orientation', 'left');
    blk(m, 'simulink/Sinks/Scope', 'Scope', [620 90 650 130]);
    blk(m, 'simulink/Sinks/Out1', 'y', [620 160 650 175]);
    ln(m, 'r/1', 'S1/1'); ln(m, 'S1/1', 'G1/1'); ln(m, 'G1/1', 'S2/1'); ln(m, 'S2/1', 'G2/1');
    ln(m, 'G2/1', 'G3/1'); ln(m, 'G2/1', 'H1/1'); ln(m, 'H1/1', 'S1/3');
    ln(m, 'G3/1', 'H2/1'); ln(m, 'H2/1', 'S2/2'); ln(m, 'G3/1', 'S1/2');
    ln(m, 'G3/1', 'Scope/1'); ln(m, 'G3/1', 'y/1');
end

%% ЭГСП 8-го порядка (задание к практическим занятиям 01–02, E = 1e7 Па).
%  Золотник и поршень m·x'' + h·x' + c·x = F·p собраны из двух интеграторов (ускорение → скорость →
%  положение): скорость нужна для обратных связей F_з·dx/dt и F·dY/dt.
function build_egsp(m)
    new_model(m);
    y0 = 200; row = @(x, w) [x y0 x + w y0 + 40];
    blk(m, 'simulink/Sources/Step', 'U', row(10, 40), 'Time', '0', 'Before', '0', 'After', '0.01');
    blk(m, 'simulink/Math Operations/Sum', 'err', row(80, 30), 'Inputs', '+-');
    blk(m, 'simulink/Math Operations/Gain', 'k_us', row(140, 50), 'Gain', '50');
    blk(m, 'simulink/Continuous/Transfer Fcn', 'coil', row(220, 90), 'Numerator', '1', 'Denominator', '[0.4 80]');
    blk(m, 'simulink/Math Operations/Sum', 'torque', row(340, 30), 'Inputs', '+-');
    blk(m, 'simulink/Continuous/Transfer Fcn', 'armature', row(400, 130), 'Numerator', '1', ...
        'Denominator', '[0.3e-6 7e-5 0.1]');
    blk(m, 'simulink/Math Operations/Gain', 'k_Qphi', row(560, 50), 'Gain', '1e-3');
    blk(m, 'simulink/Math Operations/Sum', 'flow', row(640, 30), 'Inputs', '+-');
    blk(m, 'simulink/Math Operations/Gain', 'inv_k_Qp', row(700, 50), 'Gain', '1e6');
    blk(m, 'simulink/Math Operations/Gain', 'F_z', row(780, 60), 'Gain', '0.785e-4');
    blk(m, 'simulink/Math Operations/Sum', 'spool', row(870, 30), 'Inputs', '+--');
    blk(m, 'simulink/Math Operations/Gain', 'inv_m_z', row(930, 50), 'Gain', '1/0.005');
    blk(m, 'simulink/Continuous/Integrator', 'dx', row(1010, 30));
    blk(m, 'simulink/Continuous/Integrator', 'x', row(1080, 30));
    blk(m, 'simulink/Math Operations/Gain', 'h_z', [940 290 990 320], 'Gain', '0.25', 'Orientation', 'left');
    blk(m, 'simulink/Math Operations/Gain', 'two_C_gd', [940 120 990 150], 'Gain', '2', 'Orientation', 'left');
    blk(m, 'simulink/Math Operations/Gain', 'F_z_dx', [780 360 840 390], 'Gain', '0.785e-4', 'Orientation', 'left');
    blk(m, 'simulink/Math Operations/Gain', 'k_mos', [620 50 670 80], 'Gain', '10', 'Orientation', 'left');
    blk(m, 'simulink/Math Operations/Gain', 'k_Qx', row(1160, 50), 'Gain', '4.3');
    blk(m, 'simulink/Math Operations/Sum', 'cyl_flow', row(1240, 30), 'Inputs', '+-');
    blk(m, 'simulink/Continuous/Transfer Fcn', 'cylinder', row(1300, 130), 'Numerator', '1', ...
        'Denominator', '[647e-6/(2*1e7) 1e-10]');
    blk(m, 'simulink/Math Operations/Gain', 'F', row(1460, 60), 'Gain', '1.99e-3');
    blk(m, 'simulink/Math Operations/Sum', 'piston', row(1550, 30), 'Inputs', '+-');
    blk(m, 'simulink/Math Operations/Gain', 'inv_M', row(1610, 50), 'Gain', '1/10');
    blk(m, 'simulink/Continuous/Integrator', 'dY', row(1690, 30));
    blk(m, 'simulink/Continuous/Integrator', 'Y', row(1760, 30));
    blk(m, 'simulink/Math Operations/Gain', 'h', [1620 290 1670 320], 'Gain', '10', 'Orientation', 'left');
    blk(m, 'simulink/Math Operations/Gain', 'F_dY', [1420 360 1480 390], 'Gain', '1.99e-3', 'Orientation', 'left');
    blk(m, 'simulink/Math Operations/Gain', 'k_os', [900 440 950 470], 'Gain', '0.1', 'Orientation', 'left');
    blk(m, 'simulink/Sinks/Scope', 'Scope', row(1880, 30));
    blk(m, 'simulink/Sinks/Out1', 'Y_out', [1880 280 1910 295]);
    chain = {'U', 'err', 'k_us', 'coil', 'torque', 'armature', 'k_Qphi', 'flow', 'inv_k_Qp', 'F_z', ...
             'spool', 'inv_m_z', 'dx', 'x', 'k_Qx', 'cyl_flow', 'cylinder', 'F', 'piston', 'inv_M', 'dY', 'Y'};
    for i = 1:numel(chain) - 1
        ln(m, [chain{i} '/1'], [chain{i + 1} '/1']);
    end
    ln(m, 'dx/1', 'h_z/1');      ln(m, 'h_z/1', 'spool/3');       % трение золотника
    ln(m, 'x/1', 'two_C_gd/1');  ln(m, 'two_C_gd/1', 'spool/2');  % жёсткость пружин
    ln(m, 'dx/1', 'F_z_dx/1');   ln(m, 'F_z_dx/1', 'flow/2');     % F_з·dx/dt
    ln(m, 'x/1', 'k_mos/1');     ln(m, 'k_mos/1', 'torque/2');    % механическая обратная связь
    ln(m, 'dY/1', 'h/1');        ln(m, 'h/1', 'piston/2');        % трение поршня
    ln(m, 'dY/1', 'F_dY/1');     ln(m, 'F_dY/1', 'cyl_flow/2');   % F·dY/dt
    ln(m, 'Y/1', 'k_os/1');      ln(m, 'k_os/1', 'err/2');        % главная обратная связь
    ln(m, 'Y/1', 'Scope/1');     ln(m, 'Y/1', 'Y_out/1');
end

%% Общие функции
function new_model(m)
    if bdIsLoaded(m), close_system(m, 0); end
    if exist([m '.slx'], 'file'), delete([m '.slx']); end
    new_system(m);
    open_system(m);
end

function blk(m, lib, name, pos, varargin)
    add_block(lib, [m '/' name], 'Position', pos, varargin{:});
end

function ln(m, src, dst)
    add_line(m, src, dst, 'autorouting', 'smart');
end

function run_and_save(m, t_end, dt)
    out = sim(m, 'StopTime', num2str(t_end), 'Solver', 'ode45', 'RelTol', '1e-10', 'AbsTol', '1e-12', ...
        'OutputOption', 'SpecifiedOutputTimes', 'OutputTimes', sprintf('[0:%g:%g]', dt, t_end), ...
        'SaveTime', 'on', 'TimeSaveName', 'tout', 'SaveOutput', 'on', 'OutputSaveName', 'yout', ...
        'SaveFormat', 'Array', 'ReturnWorkspaceOutputs', 'on');
    t = out.get('tout'); y = out.get('yout');
    writematrix([t y], ['simulink_' erase(m, 'kp_') '.csv']);
    save_system(m, [m '.slx']);
    print(['-s' m], '-dpng', '-r150', [m '.png']);
    fprintf('%s: %d точек, y(t_end) = %.10g\n', m, numel(t), y(end));
end
