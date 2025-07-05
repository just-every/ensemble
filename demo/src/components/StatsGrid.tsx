import React from 'react';

interface StatItem {
    label: string;
    value: string | number;
    icon?: string;
}

interface StatsGridProps {
    stats: StatItem[];
    columns?: number;
}

const StatsGrid: React.FC<StatsGridProps> = ({ stats, columns = 2 }) => {
    const gridClass = columns === 3 ? 'stats-grid three-col' : 'stats-grid';

    return (
        <div className={gridClass}>
            {stats.map((stat, index) => (
                <div key={index} className="stat-item">
                    <div className="stat-label">
                        {stat.icon && <span className="stat-icon">{stat.icon}</span>}
                        {stat.label}
                    </div>
                    <div className="stat-value">{stat.value}</div>
                </div>
            ))}
        </div>
    );
};

export default StatsGrid;
