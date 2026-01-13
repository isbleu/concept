import numpy as np

def bootstrap_95_ci(data, n_boot=1000):
    """
    简要版 Bootstrap 计算 95% 置信区间
    :param data: 输入样本数据（一维数组/列表）
    :param n_boot: Bootstrap 抽样次数（默认1000次，与seaborn默认一致）
    :return: 样本均值、95%置信区间下限、95%置信区间上限
    """
    # 步骤1：计算原始样本均值
    sample_mean = np.mean(data)
    
    # 步骤2：Bootstrap 有放回抽样，生成n_boot个/bootstrap均值
    boot_means = []
    data = np.array(data)
    n_sample = len(data)  # 原始样本量
    for _ in range(n_boot):
        # 有放回抽样：从原始数据中抽取与原样本量相同的样本
        boot_sample = np.random.choice(data, size=n_sample, replace=True)
        # 计算本次抽样的均值并保存
        boot_means.append(np.mean(boot_sample))
    
    # 步骤3：取2.5%和97.5%百分位数，得到95%置信区间
    ci_lower = np.percentile(boot_means, 2.5)  # 下限
    ci_upper = np.percentile(boot_means, 97.5)  # 上限
    
    return sample_mean, ci_lower, ci_upper

# ---------------------- 测试示例（使用之前的金融收益率数据）----------------------
if __name__ == "__main__":
    # 模拟x=0.5处的R1M_Usd样本数据
    r1m_usd_data = [0.01, 0.02, 0.015, 0.025, 0.018]
    
    # 调用函数计算
    mean_val, lower_val, upper_val = bootstrap_95_ci(r1m_usd_data)
    
    # 打印结果
    print(f"原始样本均值：{mean_val:.6f}")
    print(f"95%置信区间下限：{lower_val:.6f}")
    print(f"95%置信区间上限：{upper_val:.6f}")