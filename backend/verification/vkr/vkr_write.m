function vkr_write(path, T, L, w, with_quality)
% Записывает характеристики системы T (вход -> выход) и разомкнутого контура L в CSV.
% Используются только стандартные функции MATLAB Control System Toolbox:
% pole, dcgain, stepinfo, bode, margin, ctrb, obsv.
p = pole(T);
stable = all(real(p) < 0);
f = fopen(path, 'w');
row(f, 'pole_re', real(p));
row(f, 'pole_im', imag(p));
if stable
    row(f, 'dcgain', dcgain(T));
else
    row(f, 'dcgain', NaN);
end
if with_quality && stable
    % stepinfo: перерегулирование, время нарастания 10–90 %, время регулирования (зона 2 %)
    info = stepinfo(T);
    row(f, 'overshoot', info.Overshoot);
    row(f, 'rise', info.RiseTime);
    row(f, 'settling', info.SettlingTime);
end
[mag, ph] = bode(T, w);
row(f, 'w', w);
row(f, 'mag_db', 20*log10(squeeze(mag))');
row(f, 'phase_deg', squeeze(ph)');
if ~isempty(L)
    % margin: запас по амплитуде (в разах), запас по фазе (градусы) и частоты, на которых они определены
    [gm, pm, wcg, wcp] = margin(L);
    row(f, 'margin', [gm, pm, wcg, wcp]);
end
sys = ss(T);
row(f, 'order', size(sys.A, 1));
row(f, 'ctrb_rank', rank(ctrb(sys.A, sys.B)));
row(f, 'obsv_rank', rank(obsv(sys.A, sys.C)));
fclose(f);
end

function row(f, name, values)
fprintf(f, '%s', name);
fprintf(f, ',%.17g', values);
fprintf(f, '\n');
end
